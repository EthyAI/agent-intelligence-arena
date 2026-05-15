import { XLAYER_RPC } from "@ethy-arena/shared"
import { decodeFunctionData, parseAbi } from "viem"

const MAX_TX_AGE_MS = 10 * 60 * 1000 // 10 minutes
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

// ERC-4337 EntryPoint addresses (canonical, identical across chains).
const EIP4337_ENTRYPOINT_V07 = "0x0000000071727de22e5e9d8baf0edac6f37da032"
const EIP4337_ENTRYPOINT_V06 = "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789"

const ENTRYPOINT_V07_ABI = parseAbi([
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address beneficiary)",
])

const ENTRYPOINT_V06_ABI = parseAbi([
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature)[] ops, address beneficiary)",
])

type VerifyResult =
  | { valid: true; tokenAmount: number | null }
  | { valid: false; reason: string }

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(XLAYER_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const data = await res.json()
  return data.result
}

/**
 * Resolve the *logical* sender of a TX, accounting for ERC-4337 bundled
 * UserOperations. For traditional EOAs, returns [tx.from]. For 4337 bundler
 * TXs (tx.to === EntryPoint), decodes handleOps and returns every ops[i].sender.
 *
 * EIP-7702 delegations need no special handling: tx.from is already the EOA.
 */
function extractEffectiveSenders(tx: Record<string, string>): string[] {
  const txTo = tx.to?.toLowerCase()
  const isV07 = txTo === EIP4337_ENTRYPOINT_V07
  const isV06 = txTo === EIP4337_ENTRYPOINT_V06

  if (!isV07 && !isV06) {
    return [tx.from.toLowerCase()]
  }

  if (!tx.input || tx.input === "0x") {
    return [tx.from.toLowerCase()]
  }

  try {
    const abi = isV07 ? ENTRYPOINT_V07_ABI : ENTRYPOINT_V06_ABI
    const decoded = decodeFunctionData({ abi, data: tx.input as `0x${string}` })
    if (decoded.functionName === "handleOps") {
      const ops = decoded.args[0] as readonly { sender: string }[]
      return ops.map((op) => op.sender.toLowerCase())
    }
  } catch {
    // Unrecognized calldata — fall through to bundler address
  }

  return [tx.from.toLowerCase()]
}

/**
 * Verify a trade TX hash on X Layer:
 * 1. TX exists on-chain
 * 2. TX sender matches the agent's wallet
 * 3. TX is recent (within MAX_TX_AGE_MS)
 * 4. TX involves a Transfer of the expected token (swap verification)
 */
export async function verifyTradeTx(
  txHash: string,
  agentWallet: string,
  tokenAddress?: string,
): Promise<VerifyResult> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return { valid: false, reason: "Invalid TX hash format" }
  }

  try {
    // Fetch transaction
    const tx = await rpcCall("eth_getTransactionByHash", [txHash]) as Record<string, string> | null
    if (!tx) {
      return { valid: false, reason: "TX not found on X Layer" }
    }

    // Check sender matches agent wallet — supports EOA, ERC-4337 (OKX Agentic
    // Wallet / Biconomy / Alchemy / Coinbase Smart Wallet / Safe-4337…) and
    // EIP-7702 delegated EOAs.
    const senders = extractEffectiveSenders(tx)
    if (!senders.includes(agentWallet.toLowerCase())) {
      return { valid: false, reason: "TX sender does not match agent wallet" }
    }

    // TX must be confirmed (has a block number)
    if (!tx.blockNumber) {
      return { valid: false, reason: "TX not yet confirmed" }
    }

    // Check TX is recent via block timestamp
    const block = await rpcCall("eth_getBlockByNumber", [tx.blockNumber, false]) as Record<string, string> | null
    if (block?.timestamp) {
      const blockTime = parseInt(block.timestamp, 16) * 1000
      const age = Date.now() - blockTime
      if (age > MAX_TX_AGE_MS) {
        return { valid: false, reason: `TX too old (${Math.round(age / 60000)}min ago, max ${MAX_TX_AGE_MS / 60000}min)` }
      }
    }

    // Verify TX involves a Transfer of the expected token + extract amount
    let tokenAmount: number | null = null

    if (tokenAddress) {
      const receipt = await rpcCall("eth_getTransactionReceipt", [txHash]) as {
        logs: Array<{ address: string; topics: string[]; data: string }>
      } | null

      if (!receipt) {
        return { valid: false, reason: "TX receipt not found" }
      }

      // Find Transfer logs for the expected token
      const tokenTransfers = receipt.logs.filter(
        (log) =>
          log.topics[0] === TRANSFER_TOPIC &&
          log.address.toLowerCase() === tokenAddress.toLowerCase(),
      )

      if (tokenTransfers.length === 0) {
        return { valid: false, reason: "TX does not involve the specified token" }
      }

      // Extract amount from the last Transfer event (swap output)
      const lastTransfer = tokenTransfers[tokenTransfers.length - 1]
      if (lastTransfer.data && lastTransfer.data !== "0x") {
        tokenAmount = Number(BigInt(lastTransfer.data))
      }
    }

    return { valid: true, tokenAmount }
  } catch (err) {
    return { valid: false, reason: `RPC error: ${err instanceof Error ? err.message : "unknown"}` }
  }
}

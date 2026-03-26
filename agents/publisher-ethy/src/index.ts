/**
 * Ethy Publisher Agent
 *
 * Autonomous signal publisher for the Ethy Arena.
 * 1. Self-registers on the Arena (saves API key to disk)
 * 2. Fetches 15-minute candles, calculates RSI/ATR/volume
 * 3. Executes a real swap on X Layer via OnchainOS
 * 4. Publishes the signal with the trade TX hash as proof
 *
 * Usage: pnpm publisher (15min intervals)
 */

import { XLAYER_TOKENS, XLAYER_RPC, USDT_ADDRESS, swapExecute } from "@ethy-arena/shared"
import { getCandles } from "./okx-market.js"
import { rsi, atr, volumeChange } from "./indicators.js"
import { readFileSync, writeFileSync, existsSync } from "fs"
import crypto from "crypto"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { ethers } from "ethers"

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = join(__dirname, "..", ".publisher-state.json")

const ARENA_URL = process.env.ARENA_URL!
const WALLET = process.env.PUBLISHER_WALLET!
const INTERVAL = 15 * 60_000
// Swap amount for proof-of-trade (1 USDT = 1000000 in 6 decimals)
const SWAP_AMOUNT = process.env.SWAP_AMOUNT || "1000000"

// --- State management ---

type PublisherState = {
  agentId: string
  apiKey: string
  registeredAt: string
}

function loadState(): PublisherState | null {
  // Check env var first (for Railway deployment)
  if (process.env.PUBLISHER_API_KEY) {
    return {
      agentId: WALLET.toLowerCase(),
      apiKey: process.env.PUBLISHER_API_KEY,
      registeredAt: "env",
    }
  }
  if (!existsSync(STATE_FILE)) return null
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"))
  } catch {
    return null
  }
}

function saveState(state: PublisherState) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  console.log(`  State saved to ${STATE_FILE}`)
}

// --- x402 payment signing (EIP-3009 transferWithAuthorization) ---

async function signX402Payment(accept: {
  maxAmountRequired: string
  asset: string
  payTo: string
  chainIndex: string
}) {
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider)
  const nonce = ethers.hexlify(ethers.randomBytes(32))
  const validAfter = "0"
  const validBefore = String(Math.floor(Date.now() / 1000) + 300)

  const domain = {
    name: "USD₮0",
    version: "1",
    chainId: Number(accept.chainIndex),
    verifyingContract: accept.asset,
  }

  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  }

  const value = {
    from: wallet.address,
    to: accept.payTo,
    value: accept.maxAmountRequired,
    validAfter,
    validBefore,
    nonce,
  }

  const signature = await wallet.signTypedData(domain, types, value)

  return {
    x402Version: 1,
    scheme: "exact",
    chainIndex: accept.chainIndex,
    payload: {
      signature,
      authorization: {
        from: wallet.address,
        to: accept.payTo,
        value: accept.maxAmountRequired,
        validAfter,
        validBefore,
        nonce,
      },
    },
  }
}

// --- Registration ---

async function registerAgent(): Promise<PublisherState> {
  console.log("\n--- Self-Registration ---")
  console.log(`  Registering wallet ${WALLET} on Arena...`)

  const body = {
    name: "Ethy AI",
    description: "Autonomous signal publisher — RSI/ATR/volume analysis on X Layer tokens",
    pricePerQuery: 0.1,
  }

  // First call without payment to get 402 requirements
  const res402 = await fetch(`${ARENA_URL}/api/agents/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (res402.status === 409) {
    console.log("  Agent already registered. Set PUBLISHER_API_KEY env var.")
    process.exit(1)
  }

  if (res402.status !== 402) {
    const err = await res402.text()
    throw new Error(`Expected 402, got ${res402.status}: ${err}`)
  }

  // Get payment requirements from header
  const payReqHeader = res402.headers.get("PAYMENT-REQUIRED")
  if (!payReqHeader) throw new Error("No PAYMENT-REQUIRED header in 402 response")
  const payReq = JSON.parse(Buffer.from(payReqHeader, "base64").toString())
  const accept = payReq.accepts[0]
  console.log(`  Payment required: ${accept.maxAmountRequired} (${accept.description})`)

  // Sign x402 payment with own wallet (EIP-3009)
  console.log(`  Signing x402 payment with wallet ${WALLET}...`)
  const paymentPayload = await signX402Payment(accept)
  const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64")

  // Retry with payment header
  const res = await fetch(`${ARENA_URL}/api/agents/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PAYMENT": paymentHeader,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(`Registration failed: ${JSON.stringify(err)}`)
  }

  const data = await res.json() as { agentId: string; apiKey: string }
  console.log(`  Registered! Agent ID: ${data.agentId}`)

  const state: PublisherState = {
    agentId: data.agentId,
    apiKey: data.apiKey,
    registeredAt: new Date().toISOString(),
  }
  saveState(state)
  return state
}

// --- Swap execution ---

const PRIVATE_KEY = process.env.PUBLISHER_PRIVATE_KEY!
const provider = new ethers.JsonRpcProvider(XLAYER_RPC)
const ERC20_ABI = ["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]

async function ensureApproval(tokenAddress: string, spender: string) {
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider)
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet)
  const allowance = await token.allowance(WALLET, spender)
  if (allowance < BigInt("0xffffffffffffff")) {
    console.log(`  Approving ${spender.slice(0, 10)}... to spend token...`)
    const tx = await token.approve(spender, ethers.MaxUint256)
    await tx.wait(1)
    console.log(`  Approved!`)
  }
}

async function executeSwap(
  tokenAddress: string,
  action: "BUY" | "SELL",
): Promise<string | null> {
  console.log(`  Executing ${action} swap on X Layer...`)

  if (!PRIVATE_KEY) {
    console.error("  PUBLISHER_PRIVATE_KEY is required for swaps")
    return null
  }

  const from = action === "BUY" ? USDT_ADDRESS : tokenAddress
  const to = action === "BUY" ? tokenAddress : USDT_ADDRESS

  // Step 1: Get swap quote + unsigned TX from OnchainOS
  const result = await swapExecute({
    from,
    to,
    amount: SWAP_AMOUNT,
    wallet: WALLET,
    chain: "xlayer",
    slippage: "1",
  })

  if (!result.ok || !result.data) {
    console.error(`  Swap quote failed: ${result.error}`)
    return null
  }

  const data = Array.isArray(result.data) ? result.data[0] : result.data
  const txData = (data as Record<string, unknown>).tx as {
    to: string; data: string; value: string; gas: string; gasPrice: string
  } | undefined

  if (!txData) {
    console.error("  No TX data in swap response")
    return null
  }

  // Step 2: Ensure token approval for DEX (use onchainos approve to get correct spender)
  try {
    const { onchainos: oc } = await import("@ethy-arena/shared")
    const approveResult = await oc<Array<{ dexContractAddress: string }>>("swap approve", {
      token: from,
      amount: SWAP_AMOUNT,
      chain: "xlayer",
    })
    const approveAddr = approveResult.data?.[0]?.dexContractAddress
    if (approveAddr) {
      await ensureApproval(from, approveAddr)
    }
  } catch (err) {
    console.error(`  Approval failed:`, err instanceof Error ? err.message : err)
    return null
  }

  // Step 3: Sign and send the swap TX
  try {
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider)
    const nonce = await provider.getTransactionCount(WALLET)

    const tx = await wallet.sendTransaction({
      to: txData.to,
      data: txData.data,
      value: txData.value || "0",
      gasLimit: BigInt(txData.gas),
      gasPrice: BigInt(txData.gasPrice),
      nonce,
    })

    console.log(`  TX sent: ${tx.hash}`)
    const receipt = await tx.wait(1)
    if (!receipt || receipt.status !== 1) {
      console.error("  TX reverted!")
      return null
    }

    console.log(`  Swap confirmed in block ${receipt.blockNumber}`)
    return tx.hash
  } catch (err) {
    console.error(`  TX error:`, err instanceof Error ? err.message : err)
    return null
  }
}

// --- Signal publishing ---

async function publishSignal(apiKey: string, signal: Record<string, unknown>) {
  try {
    const res = await fetch(`${ARENA_URL}/api/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(signal),
    })
    const data = await res.json()
    if (res.ok) {
      console.log(`  Published: ${data.signalId} (price: $${data.marketPrice})`)
    } else {
      console.error(`  Publish failed:`, data)
    }
  } catch (err) {
    console.error(`  Network error:`, err)
  }
}

// --- Helpers ---

function round(n: number, decimals = 2): number {
  return Math.round(n * 10 ** decimals) / 10 ** decimals
}

// --- Analysis ---

function buildSignal(
  token: (typeof XLAYER_TOKENS)[number],
  action: "BUY" | "SELL",
  price: number,
  atrVal: number,
  rsiVal: number,
  volChange: number,
  tradeTxHash: string,
) {
  const conf = Math.max(
    0,
    Math.min(
      95,
      Math.floor(
        action === "BUY"
          ? 70 + (35 - rsiVal) + volChange / 20
          : 65 + (rsiVal - 65) + Math.abs(volChange) / 10,
      ),
    ),
  )

  const regime =
    rsiVal < 30 ? "oversold" :
    rsiVal < 45 ? "accumulation" :
    rsiVal > 70 ? "overbought" :
    rsiVal > 55 ? "distribution" : "neutral"

  return {
    token: token.symbol,
    tokenAddress: token.address,
    pair: token.pair,
    action,
    tradeTxHash,
    takeProfit: round(
      action === "BUY" ? price + atrVal * 2 : price - atrVal * 2,
    ),
    stopLoss: round(action === "BUY" ? price - atrVal : price + atrVal),
    confidence: conf,
    validFor: "7d",
    indicators: { rsi: round(rsiVal), atr: round(atrVal), volumeChange: round(volChange), regime },
    reasoning: `RSI ${action === "BUY" ? "oversold" : "overbought"} at ${round(rsiVal)}, ATR ${round(atrVal)}, volume ${volChange > 0 ? "+" : ""}${round(volChange)}%. Market regime: ${regime}.`,
  }
}

async function analyzeAndPublish(
  apiKey: string,
  token: (typeof XLAYER_TOKENS)[number],
) {
  const candles = await getCandles(token.address, "15m", 100)
  if (candles.length < 20) {
    console.log(`  ${token.symbol}: insufficient data (${candles.length} candles)`)
    return
  }

  const closes = candles.map((c) => c.close)
  const volumes = candles.map((c) => c.volume)
  const currentPrice = closes[closes.length - 1]

  const rsiVal = rsi(closes)
  const atrVal = atr(candles)
  const volChange = volumeChange(volumes)

  console.log(
    `  ${token.symbol}: $${round(currentPrice)} RSI=${round(rsiVal)} vol=${round(volChange)}% ATR=${round(atrVal)}`,
  )

  let action: "BUY" | "SELL" | null = null

  // BUY: RSI oversold + volume spike
  if (rsiVal < 35 && volChange > 50) action = "BUY"
  // SELL: RSI overbought + volume declining
  else if (rsiVal > 65 && volChange < -20) action = "SELL"

  if (!action) return

  // Execute real swap before publishing
  const txHash = await executeSwap(token.address, action)
  if (!txHash) {
    console.log(`  Skipping ${token.symbol} — swap failed`)
    return
  }

  const signal = buildSignal(token, action, currentPrice, atrVal, rsiVal, volChange, txHash)
  await publishSignal(apiKey, signal)
}

// --- Main ---

async function main() {
  console.log("═══════════════════════════════════════")
  console.log("  Ethy Publisher Agent")
  console.log(`  Interval: ${INTERVAL / 1000}s`)
  console.log(`  Arena: ${ARENA_URL}`)
  console.log(`  Wallet: ${WALLET}`)
  console.log(`  Tokens: ${XLAYER_TOKENS.map((t) => t.symbol).join(", ")}`)
  console.log("═══════════════════════════════════════\n")

  if (!ARENA_URL || !WALLET || !PRIVATE_KEY) {
    console.error("Error: ARENA_URL, PUBLISHER_WALLET, and PUBLISHER_PRIVATE_KEY are required")
    process.exit(1)
  }

  // Load or create registration
  let state = loadState()
  if (!state) {
    state = await registerAgent()
  }
  console.log(`Agent: ${state.agentId}`)
  console.log(`API Key: ${state.apiKey.slice(0, 12)}...`)

  const tick = async () => {
    const now = new Date().toISOString().slice(11, 19)
    console.log(`\n[${now}] Analyzing...`)

    for (const token of XLAYER_TOKENS) {
      await analyzeAndPublish(state!.apiKey, token)
    }
  }

  await tick()
  setInterval(tick, INTERVAL)
}

main().catch(console.error)

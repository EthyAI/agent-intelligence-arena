/**
 * Shared publisher agent utilities.
 * Used by publisher-ethy and _local (AlphaQuant) agents.
 */

import { ethers } from "ethers"
import { createWalletClient, http, publicActions } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { xLayer } from "viem/chains"
import { wrapFetchWithPayment, x402Client } from "@okxweb3/x402-fetch"
import { ExactEvmScheme } from "@okxweb3/x402-evm"
import { USDT_ADDRESS, XLAYER_RPC } from "./constants.js"
import { swapExecute, onchainos } from "./onchainos.js"
import { readFileSync, writeFileSync, existsSync } from "fs"

const ERC20_ABI = [
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]

export type PublisherState = {
  agentId: string
  apiKey: string
  registeredAt: string
}

export function loadPublisherState(stateFile: string, wallet: string): PublisherState | null {
  if (process.env.PUBLISHER_API_KEY) {
    return {
      agentId: wallet.toLowerCase(),
      apiKey: process.env.PUBLISHER_API_KEY,
      registeredAt: "env",
    }
  }
  if (!existsSync(stateFile)) return null
  try {
    return JSON.parse(readFileSync(stateFile, "utf-8"))
  } catch {
    return null
  }
}

export function savePublisherState(stateFile: string, state: PublisherState) {
  writeFileSync(stateFile, JSON.stringify(state, null, 2))
  console.log(`  State saved to ${stateFile}`)
}

export async function registerPublisher(config: {
  name: string
  description: string
  pricePerQuery: number
  arenaUrl: string
  wallet: ethers.Wallet
  stateFile: string
}): Promise<PublisherState> {
  console.log("\n--- Self-Registration ---")
  console.log(`  Registering wallet ${config.wallet.address} on Arena...`)

  const body = {
    name: config.name,
    description: config.description,
    pricePerQuery: config.pricePerQuery,
  }

  // x402 v2 payment flow via @okxweb3 SDK. The wrapped fetch handles the
  // 402 → sign EIP-3009 authorization → retry with PAYMENT-SIGNATURE round-trip.
  // Reuse the ethers wallet's key for a viem signer (same pattern as the consumer).
  const pk = config.wallet.privateKey
  const account = privateKeyToAccount(
    (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`,
  )
  const viemWallet = createWalletClient({
    account,
    chain: xLayer,
    transport: http(XLAYER_RPC),
  }).extend(publicActions)

  const signer = {
    address: account.address,
    signTypedData: (msg: {
      domain: Record<string, unknown>
      types: Record<string, unknown>
      primaryType: string
      message: Record<string, unknown>
    }) =>
      viemWallet.signTypedData({
        account,
        domain: msg.domain as Parameters<typeof viemWallet.signTypedData>[0]["domain"],
        types: msg.types as Parameters<typeof viemWallet.signTypedData>[0]["types"],
        primaryType: msg.primaryType,
        message: msg.message,
      }),
  }

  const client = x402Client.fromConfig({
    schemes: [
      {
        network: "eip155:196",
        client: new ExactEvmScheme(signer),
        x402Version: 2,
      },
    ],
  })
  const paidFetch = wrapFetchWithPayment(globalThis.fetch, client)

  const res = await paidFetch(`${config.arenaUrl}/api/agents/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (res.status === 409) {
    console.log("  Agent already registered. Set PUBLISHER_API_KEY env var.")
    process.exit(1)
  }

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Registration failed (${res.status}): ${err}`)
  }

  const registration = await res.json() as { agentId: string; apiKey: string }
  console.log(`  Registered! Agent ID: ${registration.agentId}`)

  const state: PublisherState = {
    agentId: registration.agentId,
    apiKey: registration.apiKey,
    registeredAt: new Date().toISOString(),
  }
  savePublisherState(config.stateFile, state)
  return state
}

async function ensureApproval(wallet: ethers.Wallet, tokenAddress: string, spender: string) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet)
  const allowance = await token.allowance(wallet.address, spender)
  if (allowance < BigInt("0xffffffffffffff")) {
    console.log(`  Approving ${spender.slice(0, 10)}... to spend token...`)
    const tx = await token.approve(spender, ethers.MaxUint256)
    await tx.wait(1)
    console.log(`  Approved!`)
  }
}

export async function executePublisherSwap(config: {
  tokenAddress: string
  action: "BUY" | "SELL"
  swapAmount: string
  wallet: ethers.Wallet
}): Promise<string | null> {
  console.log(`  Executing ${config.action} swap on X Layer...`)

  const from = config.action === "BUY" ? USDT_ADDRESS : config.tokenAddress
  const to = config.action === "BUY" ? config.tokenAddress : USDT_ADDRESS

  const result = await swapExecute({
    from,
    to,
    amount: config.swapAmount,
    wallet: config.wallet.address,
    chain: "xlayer",
    slippage: "1",
  })

  if (!result.ok || !result.data) {
    console.error(`  Swap quote failed: ${result.error}`)
    return null
  }

  const swapData = Array.isArray(result.data) ? result.data[0] : result.data
  const txData = (swapData as Record<string, unknown>).tx as {
    to: string; data: string; value: string; gas: string; gasPrice: string
  } | undefined

  if (!txData) {
    console.error("  No TX data in swap response")
    return null
  }

  try {
    const approveResult = await onchainos<Array<{ dexContractAddress: string }>>("swap approve", {
      token: from,
      amount: config.swapAmount,
      chain: "xlayer",
    })
    const approveAddr = approveResult.data?.[0]?.dexContractAddress
    if (approveAddr) {
      await ensureApproval(config.wallet, from, approveAddr)
    }
  } catch (err) {
    console.error(`  Approval failed:`, err instanceof Error ? err.message : err)
    return null
  }

  try {
    const nonce = await config.wallet.provider!.getTransactionCount(config.wallet.address)

    const tx = await config.wallet.sendTransaction({
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

export async function publishSignal(arenaUrl: string, apiKey: string, signal: Record<string, unknown>) {
  try {
    const res = await fetch(`${arenaUrl}/api/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(signal),
    })
    const json = await res.json()
    if (res.ok) {
      console.log(`  Published: ${json.signalId} (price: $${json.marketPrice})`)
    } else {
      console.error(`  Publish failed:`, json)
    }
  } catch (err) {
    console.error(`  Network error:`, err)
  }
}

export function round(n: number, decimals = 2): number {
  return Math.round(n * 10 ** decimals) / 10 ** decimals
}

/**
 * AlphaQuant Publisher Agent
 *
 * Momentum + trend signal publisher for the Ethy Arena.
 * Strategy: Price Rate of Change + Trend Slope + Volume Acceleration
 * Different from Ethy's RSI-based approach — trades more frequently.
 *
 * Checks every 10 minutes, 50min cooldown per token.
 */

import { XLAYER_TOKENS, XLAYER_RPC, USDT_ADDRESS, swapExecute } from "@ethy-arena/shared"
import { getCandles } from "./okx-market.js"
import { roc, trendSlope, volumeAccel, priceVsSma, atr } from "./indicators.js"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { ethers } from "ethers"

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = join(__dirname, "..", ".publisher-state.json")

const ARENA_URL = process.env.ARENA_URL!
const WALLET = process.env.PUBLISHER_WALLET!
const PRIVATE_KEY = process.env.PUBLISHER_PRIVATE_KEY!
const INTERVAL = 10 * 60_000 // 10 minutes
const SWAP_AMOUNT = process.env.SWAP_AMOUNT || "1000000"

// Cooldown per token to avoid spamming
const lastSignalTime: Record<string, number> = {}
const COOLDOWN = 50 * 60_000 // 50min per token

// --- State management ---

type PublisherState = {
  agentId: string
  apiKey: string
  registeredAt: string
}

function loadState(): PublisherState | null {
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

// --- Registration ---

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

async function registerAgent(): Promise<PublisherState> {
  console.log("\n--- Self-Registration ---")
  console.log(`  Registering wallet ${WALLET} on Arena...`)

  const body = {
    name: "AlphaQuant",
    description: "Momentum signal publisher — price rate-of-change, trend detection, and volume analysis on X Layer",
    pricePerQuery: 0.1,
  }

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

  const payReqHeader = res402.headers.get("PAYMENT-REQUIRED")
  if (!payReqHeader) throw new Error("No PAYMENT-REQUIRED header in 402 response")
  const payReq = JSON.parse(Buffer.from(payReqHeader, "base64").toString())
  const accept = payReq.accepts[0]
  console.log(`  Payment required: ${accept.maxAmountRequired}`)

  console.log(`  Signing x402 payment with wallet ${WALLET}...`)
  const paymentPayload = await signX402Payment(accept)
  const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64")

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

  const from = action === "BUY" ? USDT_ADDRESS : tokenAddress
  const to = action === "BUY" ? tokenAddress : USDT_ADDRESS

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

// --- Momentum Analysis ---

function buildSignal(
  token: (typeof XLAYER_TOKENS)[number],
  action: "BUY" | "SELL",
  price: number,
  atrVal: number,
  rocVal: number,
  slope: number,
  volAccel: number,
  priceSmaPos: number,
  tradeTxHash: string,
) {
  let conf = 55

  // ROC strength: up to +15
  conf += Math.min(15, Math.floor(Math.abs(rocVal) * 5))

  // Trend slope alignment: up to +10
  if ((action === "BUY" && slope > 0) || (action === "SELL" && slope < 0)) {
    conf += Math.min(10, Math.floor(Math.abs(slope) * 20))
  }

  // Volume acceleration: up to +10
  if (volAccel > 20) conf += Math.min(10, Math.floor(volAccel / 10))

  // Price vs SMA alignment: up to +5
  if ((action === "BUY" && priceSmaPos > 0) || (action === "SELL" && priceSmaPos < 0)) {
    conf += 5
  }

  conf = Math.max(50, Math.min(95, conf))

  const trend =
    slope > 0.1 ? "uptrend" :
    slope < -0.1 ? "downtrend" : "sideways"

  return {
    token: token.symbol,
    tokenAddress: token.address,
    pair: token.pair,
    action,
    tradeTxHash,
    takeProfit: round(
      action === "BUY" ? price + Math.max(atrVal * 2, price * 0.04) : price - Math.max(atrVal * 2, price * 0.04),
    ),
    stopLoss: round(action === "BUY" ? price - Math.max(atrVal * 1.2, price * 0.02) : price + Math.max(atrVal * 1.2, price * 0.02)),
    confidence: conf,
    validFor: "7d",
    indicators: {
      roc: round(rocVal, 3),
      trendSlope: round(slope, 4),
      volumeAccel: round(volAccel),
      priceVsSma20: round(priceSmaPos, 3),
      atr: round(atrVal),
      trend,
    },
    reasoning: `Momentum ${action === "BUY" ? "bullish" : "bearish"}: ROC ${rocVal > 0 ? "+" : ""}${round(rocVal, 3)}%, trend slope ${slope > 0 ? "+" : ""}${round(slope, 4)}, volume accel ${volAccel > 0 ? "+" : ""}${round(volAccel)}%. Trend: ${trend}.`,
  }
}

async function analyzeAndPublish(
  apiKey: string,
  token: (typeof XLAYER_TOKENS)[number],
) {
  // Cooldown check
  const lastTime = lastSignalTime[token.symbol] || 0
  if (Date.now() - lastTime < COOLDOWN) {
    console.log(`  ${token.symbol}: cooldown (${Math.round((COOLDOWN - (Date.now() - lastTime)) / 60000)}min left)`)
    return
  }

  const candles = await getCandles(token.address, "15m", 60)
  if (candles.length < 20) {
    console.log(`  ${token.symbol}: insufficient data (${candles.length} candles)`)
    return
  }

  const closes = candles.map((c) => c.close)
  const volumes = candles.map((c) => c.volume)
  const currentPrice = closes[closes.length - 1]

  const rocVal = roc(closes, 6)
  const slope = trendSlope(closes, 12)
  const volAccel = volumeAccel(volumes, 4)
  const priceSmaPos = priceVsSma(closes, 20)
  const atrVal = atr(candles)

  console.log(
    `  ${token.symbol}: $${round(currentPrice)} ROC=${round(rocVal, 3)}% slope=${round(slope, 4)} volAccel=${round(volAccel)}% pVsSma=${round(priceSmaPos, 3)}%`,
  )

  let action: "BUY" | "SELL" | null = null

  // BUY only — wallet holds USDT, not enough tokens to sell
  // BUY: price rising + positive trend + above SMA
  if (rocVal > 0.3 && slope > 0.02 && priceSmaPos > 0) {
    action = "BUY"
  }
  // BUY alt: strong momentum burst with volume
  else if (rocVal > 0.8 && volAccel > 15) {
    action = "BUY"
  }

  if (!action) return

  const txHash = await executeSwap(token.address, action)
  if (!txHash) {
    console.log(`  Skipping ${token.symbol} — swap failed`)
    return
  }

  lastSignalTime[token.symbol] = Date.now()

  const signal = buildSignal(token, action, currentPrice, atrVal, rocVal, slope, volAccel, priceSmaPos, txHash)
  await publishSignal(apiKey, signal)
}

// --- Main ---

async function main() {
  console.log("═══════════════════════════════════════")
  console.log("  AlphaQuant Publisher Agent")
  console.log(`  Strategy: Momentum (ROC/Trend/Volume)`)
  console.log(`  Interval: ${INTERVAL / 1000}s`)
  console.log(`  Cooldown: ${COOLDOWN / 60000}min per token`)
  console.log(`  Arena: ${ARENA_URL}`)
  console.log(`  Wallet: ${WALLET}`)
  console.log(`  Tokens: ${XLAYER_TOKENS.map((t) => t.symbol).join(", ")}`)
  console.log("═══════════════════════════════════════\n")

  if (!ARENA_URL || !WALLET || !PRIVATE_KEY) {
    console.error("Error: ARENA_URL, PUBLISHER_WALLET, and PUBLISHER_PRIVATE_KEY are required")
    process.exit(1)
  }

  let state = loadState()
  if (!state) {
    state = await registerAgent()
  }
  console.log(`Agent: ${state.agentId}`)
  console.log(`API Key: ${state.apiKey.slice(0, 12)}...`)

  const tick = async () => {
    const now = new Date().toISOString().slice(11, 19)
    console.log(`\n[${now}] Analyzing (momentum)...`)

    for (const token of XLAYER_TOKENS) {
      await analyzeAndPublish(state!.apiKey, token)
    }
  }

  await tick()
  setInterval(tick, INTERVAL)
}

main().catch(console.error)

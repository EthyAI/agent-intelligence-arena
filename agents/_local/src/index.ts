/**
 * AlphaQuant Publisher Agent
 *
 * Momentum + trend signal publisher for the Ethy Arena.
 * Strategy: Price Rate of Change + Trend Slope + Volume Acceleration
 * Different from Ethy's RSI-based approach — trades more frequently.
 *
 * Checks every 10 minutes, 50min cooldown per token.
 */

import { XLAYER_TOKENS, XLAYER_RPC } from "@ethy-arena/shared"
import {
  loadPublisherState,
  registerPublisher,
  executePublisherSwap,
  publishSignal,
  round,
  type PublisherState,
} from "@ethy-arena/shared/publisher"
import { getCandles } from "./okx-market.js"
import { roc, trendSlope, volumeAccel, priceVsSma, atr } from "./indicators.js"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { ethers } from "ethers"

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = join(__dirname, "..", ".publisher-state.json")

const ARENA_URL = process.env.ARENA_URL!
const WALLET_ADDR = process.env.PUBLISHER_WALLET!
const PRIVATE_KEY = process.env.PUBLISHER_PRIVATE_KEY!
const INTERVAL = 10 * 60_000
const SWAP_AMOUNT = process.env.SWAP_AMOUNT || "1000000"

const provider = new ethers.JsonRpcProvider(XLAYER_RPC)
const wallet = new ethers.Wallet(PRIVATE_KEY, provider)

// Cooldown per token to avoid spamming
const lastSignalTime: Record<string, number> = {}
const COOLDOWN = 50 * 60_000

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

  conf += Math.min(15, Math.floor(Math.abs(rocVal) * 5))

  if ((action === "BUY" && slope > 0) || (action === "SELL" && slope < 0)) {
    conf += Math.min(10, Math.floor(Math.abs(slope) * 20))
  }

  if (volAccel > 20) conf += Math.min(10, Math.floor(volAccel / 10))

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

  if (rocVal > 0.3 && slope > 0.02 && priceSmaPos > 0) {
    action = "BUY"
  } else if (rocVal > 0.8 && volAccel > 15) {
    action = "BUY"
  }

  if (!action) return

  const txHash = await executePublisherSwap({
    tokenAddress: token.address,
    action,
    swapAmount: SWAP_AMOUNT,
    wallet,
  })
  if (!txHash) {
    console.log(`  Skipping ${token.symbol} — swap failed`)
    return
  }

  lastSignalTime[token.symbol] = Date.now()

  const signal = buildSignal(token, action, currentPrice, atrVal, rocVal, slope, volAccel, priceSmaPos, txHash)
  await publishSignal(ARENA_URL, apiKey, signal)
}

// --- Main ---

async function main() {
  console.log("═══════════════════════════════════════")
  console.log("  AlphaQuant Publisher Agent")
  console.log(`  Strategy: Momentum (ROC/Trend/Volume)`)
  console.log(`  Interval: ${INTERVAL / 1000}s`)
  console.log(`  Cooldown: ${COOLDOWN / 60000}min per token`)
  console.log(`  Arena: ${ARENA_URL}`)
  console.log(`  Wallet: ${WALLET_ADDR}`)
  console.log(`  Tokens: ${XLAYER_TOKENS.map((t) => t.symbol).join(", ")}`)
  console.log("═══════════════════════════════════════\n")

  if (!ARENA_URL || !WALLET_ADDR || !PRIVATE_KEY) {
    console.error("Error: ARENA_URL, PUBLISHER_WALLET, and PUBLISHER_PRIVATE_KEY are required")
    process.exit(1)
  }

  let state: PublisherState | null = loadPublisherState(STATE_FILE, WALLET_ADDR)
  if (!state) {
    state = await registerPublisher({
      name: "AlphaQuant",
      description: "Momentum signal publisher — price rate-of-change, trend detection, and volume analysis on X Layer",
      pricePerQuery: 0.1,
      arenaUrl: ARENA_URL,
      wallet,
      stateFile: STATE_FILE,
    })
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

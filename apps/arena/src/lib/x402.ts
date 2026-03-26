/**
 * x402 payment middleware for OKX facilitator on X Layer.
 *
 * Implements the x402 HTTP payment protocol (https://x402.org):
 *   1. Server responds with 402 + `PAYMENT-REQUIRED` header (base64 JSON).
 *   2. Client signs a transferWithAuthorization EIP-3009 permit.
 *   3. Client retries the request with `X-PAYMENT` header (base64 JSON).
 *   4. Server verifies the signature via OKX, then settles onchain.
 *
 * Adapted for OKX's v1 x402 schema on X Layer (chain index 196).
 * Uses USDT or USDG as payment tokens — both EIP-3009 compatible.
 */

import { NextRequest, NextResponse } from "next/server"
import { okxFetch } from "./okx-client"

/** X Layer chain index used in OKX APIs */
const CHAIN_INDEX = "196"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What the server requires for payment (sent in the 402 response). */
type PaymentRequirements = {
  scheme: "exact"
  chainIndex: string
  maxAmountRequired: string
  payTo: string
  resource?: string
  description?: string
  mimeType?: string
  asset?: string
  maxTimeoutSeconds?: number
  extra?: Record<string, unknown>
}

/** What the client sends back as proof of signed payment. */
type PaymentPayload = {
  x402Version: number
  scheme: string
  chainIndex: string
  payload: {
    signature: string
    authorization: {
      from: string
      to: string
      value: string
      validAfter: string
      validBefore: string
      nonce: string
    }
  }
}

/** OKX verify endpoint response shape. */
type VerifyResponse = {
  code: string
  data: Array<{
    isValid: boolean
    payer: string
    invalidReason: string | null
  }>
}

/** OKX settle endpoint response shape. */
type SettleResponse = {
  code: string
  data: Array<{
    success: boolean
    payer: string
    txHash: string
    chainIndex: string
    chainName: string
    errorMsg: string | null
  }>
}

// ---------------------------------------------------------------------------
// Payment Configuration
// ---------------------------------------------------------------------------

export type PaymentConfig = {
  /** Amount in token smallest unit (6 decimals for USDT → "1000000" = 1 USDT) */
  amount: string
  /** Token contract address on X Layer */
  asset: string
  /** Recipient wallet address */
  payTo: string
  /** Human-readable description shown to the payer */
  description?: string
}

// ---------------------------------------------------------------------------
// 402 Response
// ---------------------------------------------------------------------------

/**
 * Build a 402 Payment Required response.
 *
 * The `PAYMENT-REQUIRED` header contains base64-encoded JSON describing
 * how much to pay, to whom, and on which chain. Clients decode this
 * to construct their EIP-3009 signature.
 */
export function paymentRequired(config: PaymentConfig): NextResponse {
  const requirements: PaymentRequirements = {
    scheme: "exact",
    chainIndex: CHAIN_INDEX,
    maxAmountRequired: config.amount,
    payTo: config.payTo,
    asset: config.asset,
    description: config.description ?? "Ethy Arena payment",
    mimeType: "application/json",
    maxTimeoutSeconds: 300,
    extra: { name: "USD₮0", version: "1" },
  }

  const header = {
    x402Version: 1,
    accepts: [requirements],
  }

  return new NextResponse(JSON.stringify({ error: "Payment Required" }), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(header)).toString(
        "base64",
      ),
    },
  })
}

// ---------------------------------------------------------------------------
// Verify & Settle
// ---------------------------------------------------------------------------

/**
 * Verify a payment signature via OKX.
 * Checks the EIP-3009 signature is valid and the payer has sufficient balance.
 * Does NOT execute onchain settlement.
 */
export async function verifyPayment(
  paymentPayload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<{ valid: boolean; payer: string; reason?: string }> {
  const body = {
    x402Version: 1,
    chainIndex: CHAIN_INDEX,
    paymentPayload,
    paymentRequirements: requirements,
  }

  const res = await okxFetch<VerifyResponse>(
    "POST",
    "/api/v6/x402/verify",
    body,
  )

  if (res.code !== "0" || !res.data?.length) {
    return { valid: false, payer: "", reason: `OKX verify failed: code ${res.code}` }
  }

  const result = res.data[0]
  return {
    valid: result.isValid,
    payer: result.payer,
    reason: result.invalidReason ?? undefined,
  }
}

/**
 * Settle a verified payment onchain via OKX.
 * Executes the EIP-3009 `transferWithAuthorization` on X Layer.
 * Returns the transaction hash on success.
 */
export async function settlePayment(
  paymentPayload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<{
  success: boolean
  txHash: string
  payer: string
  error?: string
}> {
  const body = {
    x402Version: 1,
    chainIndex: CHAIN_INDEX,
    paymentPayload,
    paymentRequirements: requirements,
  }

  const res = await okxFetch<SettleResponse>(
    "POST",
    "/api/v6/x402/settle",
    body,
  )

  if (res.code !== "0" || !res.data?.length) {
    return {
      success: false,
      txHash: "",
      payer: "",
      error: `OKX settle failed: code ${res.code}`,
    }
  }

  const result = res.data[0]
  return {
    success: result.success,
    txHash: result.txHash,
    payer: result.payer,
    error: result.errorMsg ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// Middleware Helper
// ---------------------------------------------------------------------------

export type PaymentResult = {
  /** Wallet address of the payer */
  payer: string
  /** Onchain transaction hash of the settlement */
  txHash: string
}

/**
 * End-to-end x402 payment processing for a route handler.
 *
 * Usage in an API route:
 * ```ts
 * const payment = await processPayment(req, config)
 * if (!payment) return paymentRequired(config) // no X-PAYMENT header
 * // payment.payer, payment.txHash are available
 * ```
 *
 * @returns PaymentResult on success, null if no payment header present.
 * @throws  On invalid signature or failed settlement.
 */
export async function processPayment(
  req: NextRequest,
  config: PaymentConfig,
): Promise<PaymentResult | null> {
  const paymentHeader = req.headers.get("X-PAYMENT")
  if (!paymentHeader) return null

  // Decode the base64 payment payload from the client
  const decoded = JSON.parse(
    Buffer.from(paymentHeader, "base64").toString(),
  ) as PaymentPayload

  // Build requirements matching what we advertised in the 402
  const requirements: PaymentRequirements = {
    scheme: "exact",
    chainIndex: CHAIN_INDEX,
    maxAmountRequired: config.amount,
    payTo: config.payTo,
    asset: config.asset,
    description: config.description ?? "Ethy Arena payment",
    mimeType: "application/json",
    maxTimeoutSeconds: 300,
    extra: { name: "USD₮0", version: "1" },
  }

  // Step 1: Verify signature + balance
  const verification = await verifyPayment(decoded, requirements)
  if (!verification.valid) {
    throw new Error(`Payment verification failed: ${verification.reason}`)
  }

  // Step 2: Settle onchain
  const settlement = await settlePayment(decoded, requirements)
  if (!settlement.success) {
    throw new Error(`Payment settlement failed: ${settlement.error}`)
  }

  return {
    payer: settlement.payer,
    txHash: settlement.txHash,
  }
}

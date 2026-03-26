/**
 * x402 client — handles automatic payment when receiving 402 responses.
 * Signs EIP-3009 transferWithAuthorization for USDT on X Layer.
 */

import { ethers } from "ethers"
import { XLAYER_RPC } from "@ethy-arena/shared"

export class X402Client {
  private wallet: ethers.Wallet

  constructor(privateKey: string) {
    const provider = new ethers.JsonRpcProvider(XLAYER_RPC)
    this.wallet = new ethers.Wallet(privateKey, provider)
  }

  get address() {
    return this.wallet.address
  }

  /** Fetch a URL, automatically handling x402 payment if needed. */
  async fetchWithPayment(url: string): Promise<{
    data: unknown
    paymentTxHash?: string
  }> {
    // First attempt — may get 200 or 402
    const res = await fetch(url)

    if (res.status === 200) {
      return { data: await res.json() }
    }

    if (res.status !== 402) {
      throw new Error(`Unexpected status ${res.status}: ${await res.text()}`)
    }

    // Parse payment requirements from header
    const paymentRequiredHeader = res.headers.get("PAYMENT-REQUIRED")
    if (!paymentRequiredHeader) throw new Error("Missing PAYMENT-REQUIRED header")

    const requirements = JSON.parse(
      Buffer.from(paymentRequiredHeader, "base64").toString(),
    )
    const accept = requirements.accepts[0]
    const amount = accept.maxAmountRequired
    const amountUSDT = Number(amount) / 1e6

    console.log(`  x402: paying ${amountUSDT} USDT to ${accept.payTo}`)

    // Sign EIP-3009 transferWithAuthorization
    const paymentPayload = await this.signTransferAuth(accept)

    // Retry with payment
    const paidRes = await fetch(url, {
      headers: {
        "X-PAYMENT": Buffer.from(JSON.stringify(paymentPayload)).toString("base64"),
      },
    })

    if (!paidRes.ok) {
      const err = await paidRes.text()
      throw new Error(`Payment retry failed (${paidRes.status}): ${err}`)
    }

    return {
      data: await paidRes.json(),
      paymentTxHash: paidRes.headers.get("x-payment-tx") || undefined
    }
  }

  private async signTransferAuth(accept: {
    maxAmountRequired: string
    asset: string
    payTo: string
    chainIndex: string
  }) {
    const nonce = ethers.hexlify(ethers.randomBytes(32))
    const validAfter = "0"
    const validBefore = String(Math.floor(Date.now() / 1000) + 300)

    // EIP-3009 transferWithAuthorization typed data
    const domain = {
      name: "USD₮0", // on-chain name() for USDT on X Layer
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
      from: this.wallet.address,
      to: accept.payTo,
      value: accept.maxAmountRequired,
      validAfter,
      validBefore,
      nonce,
    }

    const signature = await this.wallet.signTypedData(domain, types, value)

    return {
      x402Version: 1,
      scheme: "exact",
      chainIndex: accept.chainIndex,
      payload: {
        signature,
        authorization: {
          from: this.wallet.address,
          to: accept.payTo,
          value: accept.maxAmountRequired,
          validAfter,
          validBefore,
          nonce,
        },
      },
    }
  }
}

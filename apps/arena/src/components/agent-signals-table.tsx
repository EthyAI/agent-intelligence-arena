"use client"

import { useState } from "react"
import Link from "next/link"

type Signal = {
  id: string
  token: string
  action: string
  marketPrice: number
  takeProfit: number
  stopLoss: number
  confidence: number
  validFor: string
  status: string
  pnl: number | null
  currentPrice: number | null
  indicators: string | null
  reasoning: string | null
  tradeTxHash: string
  timestamp: string
}

const PAGE_SIZE = 25

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 0) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function AgentSignalsTable({ signals }: { signals: Signal[] }) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(signals.length / PAGE_SIZE))
  const paged = signals.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const resolvedSignals = paged.filter((s) => s.status !== "active")

  return (
    <div className="glass rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.03] flex items-center justify-between">
        <h2 className="text-xs font-mono text-zinc-300 uppercase tracking-wider">
          Signals
        </h2>
        <span className="text-[10px] font-mono text-white/60">
          {signals.length} total
        </span>
      </div>

      {signals.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-xs text-white/60 font-mono">
            No signals published yet.
          </p>
        </div>
      ) : (
        <>
          {/* Locked signals — decorative blurred rows with lock overlay */}
          <div className="relative">
            {/* Decorative locked-state preview rows */}
            <div className="blur-[6px] opacity-30 select-none pointer-events-none">
              <table className="w-full text-sm">
                <tbody>
                  {[0, 1, 2].map((i) => (
                    <tr key={i} className="border-b border-white/[0.02]">
                      <td className="px-4 py-3 font-mono text-zinc-200 font-medium text-xs">xSOL</td>
                      <td className="px-4 py-3"><span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded badge-buy">BUY</span></td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300 text-xs">$91.32</td>
                      <td className="px-4 py-3 text-right font-mono text-green-400/50 text-xs">$94.50</td>
                      <td className="px-4 py-3 text-right font-mono text-red-400/50 text-xs">$88.10</td>
                      <td className="px-4 py-3 text-center font-mono text-xs text-zinc-400">82%</td>
                      <td className="px-4 py-3 text-right text-[10px] font-mono text-white/60">3h ago</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Lock overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0a]/60">
              <svg className="w-6 h-6 text-violet-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <p className="text-[11px] text-zinc-400 font-mono mb-3">
                Unlock direction, TP, SL, confidence &amp; reasoning via x402
              </p>
              <Link
                href="/docs"
                className="text-xs font-mono font-semibold text-violet-400 hover:text-violet-300 bg-violet-500/10 border border-violet-500/20 px-4 py-1.5 rounded-lg hover:bg-violet-500/15 transition-colors"
              >
                Access now &rarr;
              </Link>
            </div>
          </div>

          {/* Resolved signals — visible */}
          {resolvedSignals.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.03] text-[10px] text-white/60 font-mono uppercase tracking-wider">
                    <th className="px-4 py-2.5 text-left font-medium">Token</th>
                    <th className="px-4 py-2.5 text-left font-medium">Side</th>
                    <th className="px-4 py-2.5 text-right font-medium">Market</th>
                    <th className="px-4 py-2.5 text-center font-medium">Valid</th>
                    <th className="px-4 py-2.5 text-right font-medium">Result</th>
                    <th className="px-4 py-2.5 text-right font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {resolvedSignals.map((sig) => {
                    const isTpHit = sig.status === "tp_hit"
                    const isSlHit = sig.status === "sl_hit"

                    let statusColor = "text-zinc-300"
                    let statusBg = "bg-zinc-400/10"
                    if (isTpHit) {
                      statusColor = "text-green-400"
                      statusBg = "bg-green-400/10"
                    } else if (isSlHit) {
                      statusColor = "text-red-400"
                      statusBg = "bg-red-400/10"
                    }

                    const pnlDisplay = sig.pnl != null
                      ? `${sig.pnl >= 0 ? "+" : ""}${sig.pnl.toFixed(2)}%`
                      : sig.status === "tp_hit" ? "TP HIT" : sig.status === "sl_hit" ? "SL HIT" : "EXPIRED"

                    return (
                      <tr key={sig.id} className="row-hover border-b border-white/[0.02]">
                        <td className="px-4 py-2.5 font-mono text-zinc-200 font-medium text-xs">
                          {sig.token}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded ${
                              sig.action === "BUY" ? "badge-buy" : "badge-sell"
                            }`}
                          >
                            {sig.action}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-zinc-300 text-xs">
                          ${sig.marketPrice.toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="font-mono text-[10px] text-white/60">
                            {sig.validFor}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${statusColor} ${statusBg}`}
                          >
                            {pnlDisplay}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-[10px] font-mono text-white/60">
                          {relativeTime(sig.timestamp)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-white/[0.03] flex items-center justify-between">
              <span className="text-[10px] font-mono text-white/60">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="text-[10px] font-mono px-2 py-1 rounded border border-white/[0.08] text-zinc-300 hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="text-[10px] font-mono px-2 py-1 rounded border border-white/[0.08] text-zinc-300 hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

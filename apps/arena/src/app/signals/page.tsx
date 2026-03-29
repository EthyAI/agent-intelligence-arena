"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AgentDrawer } from "@/components/agent-drawer"
import { relativeTime, safeParseJSON, statusStyle, statusLabel } from "@/lib/format"

type CensoredSignal = {
  id: string
  agentId: string
  timestamp: string
  token: string
  pair: string
  action: "BUY" | "SELL"
  tradeTxHash: string | null
  status: string
  pnl: number | null
  resolvedAt: string | null
}

type Event = {
  id: number
  type: string
  agentId: string | null
  data: string | null
  txHash: string | null
  createdAt: string
}

type AgentInfo = { id: string; name: string; score: number }

type FeedItem =
  | { kind: "signal"; data: CensoredSignal; ts: number }
  | { kind: "event"; data: Event; ts: number }

const PAGE_SIZE = 20

export default function SignalsPage() {
  const [signals, setSignals] = useState<CensoredSignal[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [agents, setAgents] = useState<Record<string, AgentInfo>>({})
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [drawerId, setDrawerId] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const poll = async () => {
      try {
        const res = await fetch("/api/signals-feed")
        if (!res.ok) return
        const json = await res.json()
        if (!mounted) return
        setSignals(json.signals)
        setEvents(json.events)
        setAgents(json.agents)
        setLoading(false)
      } catch { /* retry on next poll */ }
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  const agentName = (id: string) => agents[id]?.name ?? `${id.slice(0, 6)}...${id.slice(-4)}`

  const sortedAgentIds = Object.values(agents)
    .sort((a, b) => b.score - a.score)
    .map((a) => a.id)

  const feed: FeedItem[] = [
    ...signals.map((s) => ({ kind: "signal" as const, data: s, ts: new Date(s.timestamp).getTime() })),
    ...events.map((e) => ({ kind: "event" as const, data: e, ts: new Date(e.createdAt).getTime() })),
  ].sort((a, b) => b.ts - a.ts)

  const totalPages = Math.ceil(feed.length / PAGE_SIZE)
  const paginated = feed.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const agentRank = (id: string) => {
    const idx = sortedAgentIds.indexOf(id)
    return idx >= 0 ? idx + 1 : null
  }

  const AgentLink = ({ id }: { id: string }) => (
    <button onClick={() => setDrawerId(id)} className="hover:text-white transition-colors text-left">
      <span className="text-xs font-medium text-zinc-300">{agentName(id)}</span>
      {agentRank(id) && (
        <span className="text-[10px] font-mono text-white/30 ml-1.5">
          #{agentRank(id)}
        </span>
      )}
    </button>
  )

  return (
    <div className="mx-auto max-w-6xl px-6 pt-12 pb-8 space-y-8">
      <div className="text-center max-w-2xl mx-auto animate-fade-up stagger-1">
        <div className="inline-flex items-center gap-2 mb-4">
          <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse-dot-green" />
          <span className="text-[10px] font-mono text-zinc-400 tracking-wider uppercase">
            Real-time Feed
          </span>
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white" style={{ fontFamily: "var(--font-jakarta), sans-serif" }}>
          Agent-to-Agent <span className="text-violet-300">Signals</span>
        </h1>
        <p className="text-sm text-zinc-300 mt-3 leading-relaxed max-w-lg mx-auto">
          Agents publish signals backed by on-chain trades. Others pay via <span className="text-white font-mono text-xs">x402</span> to
          consume and execute autonomously. Details are gated — paying agents unlock TP, SL, confidence and reasoning.
        </p>
      </div>

      <div className="animate-fade-up stagger-2">
        {loading ? (
          <div className="glass rounded-xl p-12 text-center">
            <div className="inline-block w-5 h-5 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
            <p className="text-xs text-zinc-400 mt-3 font-mono">Loading feed...</p>
          </div>
        ) : feed.length === 0 ? (
          <div className="glass rounded-xl p-16 text-center">
            <p className="text-sm text-zinc-300">No signals yet.</p>
            <p className="text-xs text-zinc-400 mt-2">Agents are analyzing markets...</p>
          </div>
        ) : (
          <>
            <div className="glass rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.04] text-[10px] text-white/60 font-mono uppercase tracking-widest">
                      <th className="px-5 py-3 text-left font-medium">Event</th>
                      <th className="px-4 py-3 text-left font-medium">Agent</th>
                      <th className="px-4 py-3 text-left font-medium">Details</th>
                      <th className="px-4 py-3 text-right font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page === 0 && (
                      <tr className="border-b border-white/[0.02] bg-violet-500/[0.02]">
                        <td colSpan={5} className="px-5 py-3">
                          <div className="flex items-center justify-center gap-2.5">
                            <div className="flex items-center gap-1">
                              <span className="w-1 h-1 rounded-full bg-violet-400 animate-pulse" style={{ animationDelay: "0ms" }} />
                              <span className="w-1 h-1 rounded-full bg-violet-400 animate-pulse" style={{ animationDelay: "300ms" }} />
                              <span className="w-1 h-1 rounded-full bg-violet-400 animate-pulse" style={{ animationDelay: "600ms" }} />
                            </div>
                            <span className="text-[10px] font-mono text-zinc-400">
                              Listening for next agent signal...
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                    {paginated.map((item) => {
                      if (item.kind === "signal") {
                        const signal = item.data
                        return (
                          <tr key={`sig-${signal.id}`} className="border-b border-white/[0.02] group row-hover transition-colors">
                            <td className="px-5 py-3.5">
                              <span className="inline-flex items-center gap-1.5 text-xs font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                                <span className="text-violet-300">SIGNAL</span>
                              </span>
                            </td>
                            <td className="px-4 py-3.5">
                              <AgentLink id={signal.agentId} />
                            </td>
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-2">
                                {signal.status === "active" ? (
                                  <>
                                    <span className="text-xs font-mono text-zinc-300">{signal.pair}</span>
                                    {signal.tradeTxHash && (
                                      <span title="On-chain verified trade" className="text-emerald-400/80">
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                      </span>
                                    )}
                                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-zinc-400">
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                                      </svg>
                                      Unlock via x402
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                      signal.action === "BUY" ? "text-green-400 bg-green-400/10" : "text-red-400 bg-red-400/10"
                                    }`}>
                                      {signal.action}
                                    </span>
                                    <span className="text-xs font-mono text-zinc-300">{signal.pair}</span>
                                    {signal.tradeTxHash && (
                                      <a
                                        href={`https://www.okx.com/web3/explorer/xlayer/tx/${signal.tradeTxHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title="View verified trade on X Layer"
                                        className="text-emerald-400/80 hover:text-emerald-400 transition-colors"
                                      >
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                      </a>
                                    )}
                                    {signal.pnl !== null && (
                                      <span className={`text-[10px] font-mono ${signal.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                                        {signal.pnl >= 0 ? "+" : ""}{signal.pnl.toFixed(2)}%
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-md ${statusStyle(signal.status)}`}>
                                  {statusLabel(signal.status)}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span className="text-[10px] font-mono text-zinc-400">{relativeTime(signal.timestamp)}</span>
                            </td>
                          </tr>
                        )
                      }

                      const event = item.data
                      const isRegistration = event.type === "agent_registered"

                      if (isRegistration) {
                        const parsed = safeParseJSON(event.data)
                        const price = Number(parsed.pricePerQuery || 0)

                        return (
                          <tr key={`evt-${event.id}`} className="border-b border-white/[0.02] group row-hover transition-colors bg-emerald-500/[0.02]">
                            <td className="px-5 py-3.5">
                              <span className="inline-flex items-center gap-1.5 text-xs font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                <span className="text-emerald-300">x402 REGISTER</span>
                              </span>
                            </td>
                            <td className="px-4 py-3.5">
                              {event.agentId && <AgentLink id={event.agentId} />}
                            </td>
                            <td className="px-4 py-3.5">
                              <span className="text-[10px] font-mono text-zinc-400">
                                joined the arena — ${price.toFixed(2)}/query
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md text-emerald-400 bg-emerald-400/10">
                                CONFIRMED
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span className="text-[10px] font-mono text-zinc-400">{relativeTime(event.createdAt)}</span>
                            </td>
                          </tr>
                        )
                      }

                      // Payment event
                      const parsed = safeParseJSON(event.data)
                      const payer = typeof parsed.payer === "string" ? `${parsed.payer.slice(0, 6)}...${parsed.payer.slice(-4)}` : "Unknown"
                      const signalCount = Number(parsed.signalCount || 0)
                      const amount = Number(parsed.amount || 0)

                      return (
                        <tr key={`evt-${event.id}`} className="border-b border-white/[0.02] group row-hover transition-colors bg-violet-500/[0.02]">
                          <td className="px-5 py-3.5">
                            <span className="inline-flex items-center gap-1.5 text-xs font-mono">
                              <span className="w-1.5 h-1.5 rounded-full bg-pink-400" />
                              <span className="text-pink-300">x402 PAID</span>
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="text-xs font-mono text-zinc-300">{payer}</span>
                            <span className="text-[10px] text-zinc-400 mx-1.5">read from</span>
                            {event.agentId && <AgentLink id={event.agentId} />}
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="text-[10px] font-mono text-zinc-400">
                              {signalCount} signal{signalCount !== 1 ? "s" : ""} for {amount.toFixed(2)} USDT
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md text-pink-400 bg-pink-400/10">
                              CONFIRMED
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <span className="text-[10px] font-mono text-zinc-400">{relativeTime(event.createdAt)}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-[10px] font-mono text-zinc-400">
                  {feed.length} events — page {page + 1} of {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1.5 text-xs font-mono rounded-md transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-300 hover:text-white bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08]"
                  >
                    Prev
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setPage(i)}
                      className={`w-8 h-8 text-xs font-mono rounded-md transition-all duration-200 ${
                        page === i
                          ? "text-white bg-white/[0.08] border border-white/[0.1]"
                          : "text-zinc-400 hover:text-zinc-300 bg-white/[0.02] border border-white/[0.04]"
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page === totalPages - 1}
                    className="px-3 py-1.5 text-xs font-mono rounded-md transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-300 hover:text-white bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08]"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {drawerId && (
        <AgentDrawer
          agentId={drawerId}
          onClose={() => setDrawerId(null)}
          allAgentIds={sortedAgentIds}
        />
      )}

      <div className="border-t border-white/[0.03] pt-6 pb-12 text-center">
        <p className="text-[10px] font-mono text-white/60">
          Built by Ethy AI — X Layer Hackathon 2026
        </p>
      </div>
    </div>
  )
}

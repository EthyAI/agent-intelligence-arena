"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { relativeTime, safeParseJSON } from "@/lib/format"

type AgentDetail = {
  id: string
  name: string
  description: string | null
  pricePerQuery: number
  totalSignals: number
  winRate: number
  avgPnl: number
  score: number
  createdAt: string
  registrationTx: string
  activeSignals: number
}

type FeedEvent = {
  kind: string
  label: string
  detail: string
  status: string
  statusColor: string
  time: string
}

export function AgentDrawer({
  agentId,
  onClose,
  allAgentIds,
}: {
  agentId: string
  onClose: () => void
  allAgentIds: string[]
}) {
  const [agent, setAgent] = useState<AgentDetail | null>(null)
  const [events, setEvents] = useState<FeedEvent[]>([])
  const [loading, setLoading] = useState(true)

  const rank = allAgentIds.indexOf(agentId) + 1

  useEffect(() => {
    setLoading(true)
    fetch(`/api/agents/${agentId}`)
      .then((r) => r.json())
      .then((json) => {
        setAgent(json.agent)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [agentId])

  useEffect(() => {
    fetch("/api/signals-feed")
      .then((r) => r.json())
      .then((json) => {
        const items: FeedEvent[] = []

        for (const s of json.signals || []) {
          if (s.agentId !== agentId) continue
          items.push({
            kind: "signal",
            label: "SIGNAL",
            detail: `${s.action} ${s.pair}${s.pnl !== null ? ` ${s.pnl >= 0 ? "+" : ""}${s.pnl.toFixed(2)}%` : ""}`,
            status: s.status === "active" ? "LIVE" : s.status === "tp_hit" ? "TP HIT" : s.status === "sl_hit" ? "SL HIT" : "EXPIRED",
            statusColor: s.status === "active" ? "text-amber-400 bg-amber-400/10" : s.status === "tp_hit" ? "text-green-400 bg-green-400/10" : s.status === "sl_hit" ? "text-red-400 bg-red-400/10" : "text-zinc-300 bg-zinc-400/10",
            time: s.timestamp,
          })
        }

        for (const e of json.events || []) {
          if (e.agentId !== agentId) continue
          if (e.type === "agent_registered") {
            items.push({
              kind: "register",
              label: "REGISTER",
              detail: "joined the arena",
              status: "CONFIRMED",
              statusColor: "text-emerald-400 bg-emerald-400/10",
              time: e.createdAt,
            })
          } else if (e.type === "payment") {
            const parsed = safeParseJSON(e.data)
            const payer = typeof parsed.payer === "string" ? `${parsed.payer.slice(0, 6)}...${parsed.payer.slice(-4)}` : "?"
            const count = Number(parsed.signalCount || 0)
            items.push({
              kind: "payment",
              label: "x402 PAID",
              detail: `${payer} read ${count} signal${count !== 1 ? "s" : ""}`,
              status: "CONFIRMED",
              statusColor: "text-pink-400 bg-pink-400/10",
              time: e.createdAt,
            })
          }
        }

        items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
        setEvents(items.slice(0, 10))
      })
      .catch(() => {})
  }, [agentId])

  const perfColor = (wr: number) =>
    wr >= 60 ? "text-green-400" : wr >= 40 ? "text-yellow-400" : "text-zinc-400"

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-full w-full max-w-md bg-[#0a0a0a] border-l border-white/[0.06] z-50 overflow-y-auto animate-slide-in-right">
        <div className="sticky top-0 bg-[#0a0a0a]/95 backdrop-blur-sm border-b border-white/[0.04] px-6 py-4 flex items-center justify-between z-10">
          <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Agent Profile</span>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition-colors p-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading || !agent ? (
          <div className="p-6 flex items-center justify-center h-40">
            <div className="w-5 h-5 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-6 space-y-6">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-white">{agent.name}</h2>
                <span className="inline-flex items-center gap-1 font-mono text-xs font-bold gradient-text-static bg-violet-500/[0.06] border border-violet-500/10 px-2 py-0.5 rounded-md">
                  #{rank || "—"} Global
                </span>
              </div>
              {agent.description && (
                <p className="text-xs text-zinc-400 mt-1.5">{agent.description}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] font-mono text-white/40">
                  {agent.id.slice(0, 6)}...{agent.id.slice(-4)}
                </span>
                <span className="text-[10px] font-mono text-violet-400/80 bg-violet-500/[0.08] border border-violet-500/10 px-2 py-0.5 rounded-md">
                  ${agent.pricePerQuery.toFixed(2)}/query
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="glass rounded-lg p-3.5">
                <p className="text-[10px] font-mono text-white/50 uppercase tracking-widest mb-1">Win Rate</p>
                <p className={`text-2xl font-mono font-black ${perfColor(agent.winRate)}`}>
                  {agent.winRate.toFixed(1)}%
                </p>
              </div>
              <div className="glass rounded-lg p-3.5">
                <p className="text-[10px] font-mono text-white/50 uppercase tracking-widest mb-1">Avg PnL</p>
                <p className={`text-2xl font-mono font-black ${agent.avgPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {agent.avgPnl >= 0 ? "+" : ""}{agent.avgPnl.toFixed(2)}%
                </p>
              </div>
              <div className="glass rounded-lg p-3.5">
                <p className="text-[10px] font-mono text-white/50 uppercase tracking-widest mb-1">Score</p>
                <p className="text-2xl font-mono font-black gradient-text-static">
                  {agent.score.toFixed(1)}
                </p>
              </div>
              <div className="glass rounded-lg p-3.5">
                <p className="text-[10px] font-mono text-white/50 uppercase tracking-widest mb-1">Signals</p>
                <p className="text-2xl font-mono font-black text-white">
                  {agent.totalSignals}
                </p>
                <p className="text-[10px] font-mono text-amber-400/70 mt-1">
                  {agent.activeSignals} active
                </p>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-xs font-mono text-zinc-300 uppercase tracking-wider">Recent Activity</h3>
                <div className="h-px flex-1 bg-gradient-to-r from-zinc-800 to-transparent" />
              </div>

              {events.length === 0 ? (
                <p className="text-xs text-zinc-400 font-mono">No activity yet.</p>
              ) : (
                <div className="space-y-0">
                  {events.map((ev, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between py-2.5 border-b border-white/[0.03] last:border-0"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[10px] font-mono font-medium shrink-0 ${
                          ev.kind === "signal" ? "text-violet-400" : ev.kind === "register" ? "text-emerald-400" : "text-pink-400"
                        }`}>
                          {ev.label}
                        </span>
                        <span className="text-[10px] font-mono text-zinc-300 truncate">
                          {ev.detail}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className={`text-[9px] font-mono font-medium px-1.5 py-0.5 rounded ${ev.statusColor}`}>
                          {ev.status}
                        </span>
                        <span className="text-[10px] font-mono text-zinc-400 w-14 text-right">
                          {relativeTime(ev.time)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Link
              href={`/agents/${agent.id}`}
              className="block text-center text-xs font-mono text-violet-400 hover:text-violet-300 transition-colors py-2 border border-violet-500/10 rounded-lg hover:bg-violet-500/[0.04]"
            >
              View full profile &rarr;
            </Link>
          </div>
        )}
      </div>
    </>
  )
}

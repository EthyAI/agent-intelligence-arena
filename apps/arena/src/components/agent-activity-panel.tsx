"use client"

import { useEffect, useState, useCallback } from "react"

interface ActivityItem {
  id: number
  type: string
  agentId: string | null
  data: string | null
  txHash: string | null
  createdAt: string
}

type X402Event = {
  id: number
  direction: "received" | "purchased"
  amount: number
  counterparty: string // the other agent/wallet
  signalCount: number
  time: string
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 0) return "now"
  if (seconds < 5) return "now"
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function truncAddr(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function AgentActivityPanel({ agentId }: { agentId: string }) {
  const [events, setEvents] = useState<X402Event[]>([])
  const [loading, setLoading] = useState(true)

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?limit=200")
      if (!res.ok) return
      const json = await res.json()

      const results: X402Event[] = []
      const aid = agentId.toLowerCase()

      for (const a of (json.activity || []) as ActivityItem[]) {
        if (a.type !== "payment") continue
        let data: Record<string, unknown> = {}
        try { data = JSON.parse(a.data || "{}") } catch { continue }

        const payer = String(data.payer || "").toLowerCase()
        const publisherAgentId = (a.agentId || "").toLowerCase()

        if (publisherAgentId === aid) {
          // Someone paid THIS agent for signals → RECEIVED
          results.push({
            id: a.id,
            direction: "received",
            amount: Number(data.amount || 0),
            counterparty: payer,
            signalCount: Number(data.signalCount || 0),
            time: a.createdAt,
          })
        } else if (payer === aid) {
          // THIS agent paid another agent for signals → PURCHASED
          results.push({
            id: a.id,
            direction: "purchased",
            amount: Number(data.amount || 0),
            counterparty: publisherAgentId,
            signalCount: Number(data.signalCount || 0),
            time: a.createdAt,
          })
        }
      }

      setEvents(results.slice(0, 20))
    } catch {
      /* silent */
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    fetchActivity()
    const interval = setInterval(fetchActivity, 5000)
    return () => clearInterval(interval)
  }, [fetchActivity])

  return (
    <div className="glass rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.03] flex items-center justify-between">
        <h3 className="text-xs font-mono text-zinc-300 uppercase tracking-wider">
          x402 Activity
        </h3>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse-dot" />
          <span className="text-[10px] text-white/60 font-mono">live</span>
        </div>
      </div>
      <div className="px-4 py-2">
        {loading ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-8 bg-white/[0.02] rounded animate-pulse"
                style={{ animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="text-[11px] text-white/60 text-center py-8 font-mono">
            No x402 transactions yet.
          </p>
        ) : (
          <div className="space-y-0.5">
            {events.map((ev, i) => {
              const isReceived = ev.direction === "received"
              return (
                <div
                  key={ev.id}
                  className="animate-slide-in py-2.5 px-2 rounded hover:bg-white/[0.02] transition-colors"
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-white/[0.03] ${isReceived ? "text-green-400" : "text-pink-400"}`}>
                        {isReceived ? "RECEIVED" : "PURCHASE"}
                      </span>
                      <span className={`text-[11px] font-mono font-semibold ${isReceived ? "text-green-400" : "text-pink-400"}`}>
                        {isReceived ? "+" : "-"}{ev.amount.toFixed(2)} USDT
                      </span>
                    </div>
                    <span className="text-[10px] text-white/60 font-mono">
                      {relativeTime(ev.time)}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-400 font-mono mt-1">
                    {isReceived ? "from" : "to"}{" "}
                    <span className="text-zinc-300">{truncAddr(ev.counterparty)}</span>
                    {" "}&middot;{" "}
                    {ev.signalCount} signal{ev.signalCount !== 1 ? "s" : ""}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

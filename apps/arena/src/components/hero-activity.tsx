"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { relativeTime, shortId, safeParseJSON, type ActivityItem } from "@/lib/format"

const TYPE_CONFIG: Record<string, { label: string; icon: string }> = {
  signal_published: { label: "Signal", icon: "\u2197" },
  payment: { label: "x402", icon: "$" },
  agent_registered: { label: "Joined", icon: "\u2192" },
  signal_resolved: { label: "Resolved", icon: "\u2713" },
}

const KNOWN_TYPES = new Set(Object.keys(TYPE_CONFIG))

function formatDetail(item: ActivityItem): string {
  const parsed = safeParseJSON(item.data)
  switch (item.type) {
    case "signal_published":
      return `New signal on ${parsed.token || "?"}`
    case "payment": {
      const payer = typeof parsed.payer === "string" ? shortId(parsed.payer) : "agent"
      return `${payer} paid ${Number(parsed.amount || 0).toFixed(2)} USDT for ${parsed.signalCount || 1} signal${Number(parsed.signalCount || 1) > 1 ? "s" : ""}`
    }
    case "agent_registered":
      return `${parsed.name || item.agentId || "agent"} registered`
    case "signal_resolved": {
      const pnl = Number(parsed.pnl || 0)
      return `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}% ${parsed.status === "tp_hit" ? "TP hit" : "SL hit"}`
    }
    default:
      return ""
  }
}

const ROW_H = 64
const MAX_VISIBLE = 6
const POLL_INTERVAL = 5000

export function HeroActivity() {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [agentNames, setAgentNames] = useState<Record<string, string>>({})
  const [ready, setReady] = useState(false)
  const [highlightId, setHighlightId] = useState<number | null>(null)
  const lastTopIdRef = useRef<number | null>(null)
  const initialLoadRef = useRef(true)

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?limit=10")
      if (!res.ok) return
      const json = await res.json()
      const fetched: ActivityItem[] = (json.activity || [])
        .filter((item: ActivityItem) => KNOWN_TYPES.has(item.type))
      const visible = fetched.slice(0, MAX_VISIBLE)
      if (json.agentNames) setAgentNames(json.agentNames)

      if (initialLoadRef.current && visible.length > 1) {
        initialLoadRef.current = false
        const topItem = visible[0]
        setItems(visible.slice(1))
        setTimeout(() => setReady(true), 50)
        setTimeout(() => {
          setItems(visible)
          setHighlightId(topItem.id)
          lastTopIdRef.current = topItem.id
          setTimeout(() => setHighlightId(null), 1500)
        }, 600)
      } else {
        setItems(visible)
        if (!ready) setTimeout(() => setReady(true), 50)

        const topId = visible[0]?.id ?? null
        if (topId && topId !== lastTopIdRef.current) {
          setHighlightId(topId)
          setTimeout(() => setHighlightId(null), 1500)
        }
        lastTopIdRef.current = topId
      }
    } catch { /* retry on next poll */ }
  }, [ready])

  useEffect(() => { fetchActivity() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const interval = setInterval(fetchActivity, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchActivity])

  if (items.length === 0) return null

  return (
    <div
      className="relative w-full"
      style={{ height: `${ROW_H * MAX_VISIBLE}px` }}
    >
      {items.map((item, i) => {
        const config = TYPE_CONFIG[item.type]!
        const detail = formatDetail(item)
        const isHighlighted = item.id === highlightId
        const opacity = Math.max(0.08, 1 - i * 0.18)

        return (
          <div
            key={item.id}
            className={`absolute inset-x-0 ${isHighlighted ? "activity-enter" : ""}`}
            style={{
              top: `${i * ROW_H}px`,
              opacity,
              transition: ready
                ? "top 0.7s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.7s ease"
                : "none",
            }}
          >
            <div
              className="mx-1 rounded-xl border px-4 py-3 flex items-center gap-4"
              style={{
                background: isHighlighted
                  ? "rgba(139, 92, 246, 0.12)"
                  : "rgba(255, 255, 255, 0.02)",
                borderColor: isHighlighted
                  ? "rgba(139, 92, 246, 0.35)"
                  : "rgba(255, 255, 255, 0.04)",
                boxShadow: isHighlighted
                  ? "0 0 30px rgba(139, 92, 246, 0.15), inset 0 1px 0 rgba(139, 92, 246, 0.15)"
                  : "none",
                transition: "background 1.2s ease, border-color 1.2s ease, box-shadow 1.2s ease",
              }}
            >
              <span className="shrink-0 text-[11px] font-mono text-zinc-400 w-5 text-center">
                {config.icon}
              </span>

              <span className="shrink-0 text-[10px] font-mono font-medium text-zinc-400 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded">
                {config.label}
              </span>

              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-zinc-300 truncate">
                  {detail}
                </p>
              </div>

              <div className="shrink-0 flex flex-col items-end gap-0.5">
                {item.agentId && (
                  <span className="text-[10px] text-white/60 font-mono">
                    {agentNames[item.agentId] || shortId(item.agentId)}
                  </span>
                )}
                <span className="text-[10px] text-white/60 font-mono">
                  {relativeTime(item.createdAt)}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

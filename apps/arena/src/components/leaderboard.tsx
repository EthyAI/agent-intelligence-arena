"use client"

import { useState } from "react"
import Link from "next/link"

type AgentRow = {
  id: string
  name: string
  description: string | null
  pricePerQuery: number
  totalSignals: number
  winRate: number
  avgPnl: number
  score: number
}

export function Leaderboard({ agents, epochName }: { agents: AgentRow[]; epochName: string }) {
  const [tab, setTab] = useState<"season" | "global">("season")

  const sorted = [...agents].sort((a, b) => b.score - a.score || b.winRate - a.winRate)

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.06] rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab("season")}
          className={`px-3.5 py-1.5 text-xs font-mono font-medium rounded-md transition-all duration-200 ${
            tab === "season"
              ? "text-white bg-white/[0.08]"
              : "text-zinc-400 hover:text-zinc-300"
          }`}
        >
          {epochName}
        </button>
        <button
          onClick={() => setTab("global")}
          className={`px-3.5 py-1.5 text-xs font-mono font-medium rounded-md transition-all duration-200 ${
            tab === "global"
              ? "text-white bg-white/[0.08]"
              : "text-zinc-400 hover:text-zinc-300"
          }`}
        >
          Global
        </button>
      </div>

      {tab === "global" && (
        <p className="text-[10px] font-mono text-zinc-400">
          Cumulative ranking across all seasons. Scores and stats persist between epoch resets.
        </p>
      )}

      {sorted.length === 0 ? (
        <div className="glass rounded-xl p-16 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 border border-violet-500/10 mb-4">
            <span className="gradient-text-static text-xl font-mono">&#x27D0;</span>
          </div>
          <p className="text-sm text-zinc-300 font-medium">
            The Arena awaits its first contender.
          </p>
          <p className="text-xs text-white/50 mt-2">
            Deploy an agent to start competing.
          </p>
          <Link
            href="/docs"
            className="inline-flex items-center gap-1.5 text-xs font-mono text-violet-400 hover:text-violet-300 mt-4 transition-colors"
          >
            Read the docs <span>&rarr;</span>
          </Link>
        </div>
      ) : (
        <div className="glass rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.04] text-[10px] text-white/60 font-mono uppercase tracking-widest">
                  <th className="px-5 py-3 text-left font-medium w-12">#</th>
                  <th className="px-4 py-3 text-left font-medium">Agent</th>
                  <th className="px-4 py-3 text-right font-medium">Win Rate</th>
                  <th className="px-4 py-3 text-right font-medium">Avg PnL</th>
                  <th className="px-4 py-3 text-right font-medium">Score</th>
                  <th className="px-4 py-3 text-right font-medium">Signals</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((agent, i) => {
                  const rank = i + 1
                  const medal =
                    rank === 1 ? "rank-gold" : rank === 2 ? "rank-silver" : rank === 3 ? "rank-bronze" : ""
                  const performanceColor =
                    agent.winRate >= 60
                      ? "text-green-400"
                      : agent.winRate >= 40
                        ? "text-yellow-400"
                        : "text-zinc-400"

                  return (
                    <tr
                      key={agent.id}
                      className={`row-hover border-b border-white/[0.02] group transition-colors ${rank === 1 ? "rank-1-row" : rank === 2 ? "rank-2-row" : rank === 3 ? "rank-3-row" : ""}`}
                    >
                      <td className="px-5 py-4">
                        <span className={`font-mono font-black ${medal || "text-white/30"} ${rank <= 3 ? "text-lg" : "text-sm"}`}>
                          {rank}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <Link href={`/agents/${agent.id}`} className="cursor-pointer">
                          <div>
                            <span className="font-semibold text-sm text-zinc-200 group-hover:text-white transition-colors block">
                              {agent.name}
                            </span>
                            <span className="text-[10px] font-mono text-white/50 block">
                              {agent.id.slice(0, 6)}...{agent.id.slice(-4)}
                            </span>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className={`font-mono text-sm font-semibold ${performanceColor}`}>
                          {agent.winRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span
                          className={`font-mono text-sm font-semibold ${
                            agent.avgPnl >= 0 ? "text-green-400" : "text-red-400"
                          }`}
                        >
                          {agent.avgPnl >= 0 ? "+" : ""}
                          {agent.avgPnl.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className="font-mono text-sm font-semibold gradient-text-static">
                          {agent.score.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className="font-mono text-sm text-zinc-300">
                          {agent.totalSignals}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className="font-mono text-[10px] text-violet-400/80 bg-violet-500/[0.08] border border-violet-500/10 px-2 py-0.5 rounded-md">
                          ${agent.pricePerQuery.toFixed(2)}/q
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

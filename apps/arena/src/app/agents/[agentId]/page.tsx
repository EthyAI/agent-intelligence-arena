import Link from "next/link"
import { notFound } from "next/navigation"
import { getDB } from "@/db"
import { agents, signals, activity } from "@/db/schema"
import { eq, desc, sql, and } from "drizzle-orm"
import { AgentSignalsTable } from "@/components/agent-signals-table"
import { AgentActivityPanel } from "@/components/agent-activity-panel"

export const dynamic = "force-dynamic"

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}


export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>
}) {
  const { agentId } = await params
  const db = getDB()

  const [agent] = await db
    .select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      pricePerQuery: agents.pricePerQuery,
      totalSignals: agents.totalSignals,
      winRate: agents.winRate,
      avgPnl: agents.avgPnl,
      createdAt: agents.createdAt,
      registrationTx: agents.registrationTx,
    })
    .from(agents)
    .where(eq(agents.id, agentId))

  if (!agent) notFound()

  const allSignals = await db
    .select()
    .from(signals)
    .where(eq(signals.agentId, agentId))
    .orderBy(desc(signals.timestamp))

  const [activeCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(signals)
    .where(and(eq(signals.agentId, agentId), eq(signals.status, "active")))

  // Global rank
  const allAgentScores = await db
    .select({ id: agents.id, score: agents.score })
    .from(agents)
    .orderBy(desc(agents.score))
  const rank = allAgentScores.findIndex((a) => a.id === agentId) + 1

  // x402 commerce stats
  const paymentActivities = await db
    .select({ data: activity.data })
    .from(activity)
    .where(and(eq(activity.type, "payment"), eq(activity.agentId, agentId)))

  let totalEarnings = 0
  const uniqueBuyers = new Set<string>()
  for (const pa of paymentActivities) {
    if (!pa.data) continue
    try {
      const d = JSON.parse(pa.data)
      totalEarnings += Number(d.amount || 0)
      if (d.payer) uniqueBuyers.add(String(d.payer).toLowerCase())
    } catch { /* skip */ }
  }

  const stats = [
    { label: "Win Rate", value: `${agent.winRate.toFixed(1)}%`, positive: true },
    {
      label: "Avg PnL",
      value: `${agent.avgPnl >= 0 ? "+" : ""}${agent.avgPnl.toFixed(2)}%`,
      positive: agent.avgPnl >= 0,
    },
    { label: "Total Signals", value: agent.totalSignals.toString(), positive: null },
    { label: "Active Now", value: (activeCount?.count ?? 0).toString(), positive: null },
  ]

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">
      {/* Breadcrumb */}
      <nav className="animate-fade-up stagger-1 flex items-center gap-2 text-xs font-mono text-white/60">
        <Link href="/" className="hover:text-zinc-300 transition-colors">
          Arena
        </Link>
        <span className="text-white/60">/</span>
        <span className="text-zinc-400">{agent.name}</span>
      </nav>

      {/* Agent Header */}
      <div className="animate-fade-up stagger-2 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">{agent.name}</h1>
              <span className="inline-flex items-center gap-1 font-mono text-xs font-bold gradient-text-static bg-violet-500/[0.06] border border-violet-500/10 px-2 py-0.5 rounded-md">
                #{rank || "—"} Global
              </span>
            </div>
            {agent.description && (
              <p className="text-xs text-zinc-400 mt-1">{agent.description}</p>
            )}
          </div>
          <div className="flex items-center gap-4 text-[10px] text-white/60 font-mono">
            <span title={agent.id}>{truncateAddress(agent.id)}</span>
            {agent.registrationTx && (
              <a
                href={`https://www.okx.com/web3/explorer/xlayer/tx/${agent.registrationTx}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-violet-400 transition-colors"
              >
                reg tx
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-violet-400 bg-gradient-to-br from-violet-500/15 to-fuchsia-500/15 border border-violet-500/15 px-3 py-1.5 rounded-md">
            ${agent.pricePerQuery.toFixed(2)} / query
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="animate-fade-up stagger-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className={`stat-glow stat-inner-glow glass rounded-lg p-4 animate-fade-up stagger-${i + 3}`}
          >
            <p className="text-[10px] font-mono text-white/60 uppercase tracking-widest">
              {stat.label}
            </p>
            <p
              className={`text-2xl md:text-3xl font-mono font-black mt-1.5 ${
                stat.positive === true
                  ? "text-green-400"
                  : stat.positive === false
                    ? "text-red-400"
                    : "text-zinc-200"
              }`}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* x402 Commerce Stats */}
      <div className="animate-fade-up stagger-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="glass rounded-lg p-4">
          <p className="text-[10px] font-mono text-white/60 uppercase tracking-widest">Earnings</p>
          <p className="text-2xl md:text-3xl font-mono font-black mt-1.5 text-green-400">
            <span className="gradient-text-static">$</span>{totalEarnings.toFixed(2)}
          </p>
          <p className="text-[10px] font-mono text-white/40 mt-0.5">USDT received</p>
        </div>
        <div className="glass rounded-lg p-4">
          <p className="text-[10px] font-mono text-white/60 uppercase tracking-widest">Payments</p>
          <p className="text-2xl md:text-3xl font-mono font-black mt-1.5 text-zinc-200">
            {paymentActivities.length}
          </p>
          <p className="text-[10px] font-mono text-white/40 mt-0.5">x402 transactions</p>
        </div>
        <div className="glass rounded-lg p-4">
          <p className="text-[10px] font-mono text-white/60 uppercase tracking-widest">Unique Buyers</p>
          <p className="text-2xl md:text-3xl font-mono font-black mt-1.5 text-zinc-200">
            {uniqueBuyers.size}
          </p>
          <p className="text-[10px] font-mono text-white/40 mt-0.5">agents / wallets</p>
        </div>
        <div className="glass rounded-lg p-4">
          <p className="text-[10px] font-mono text-white/60 uppercase tracking-widest">Price</p>
          <p className="text-2xl md:text-3xl font-mono font-black mt-1.5 text-violet-400">
            ${agent.pricePerQuery.toFixed(2)}
          </p>
          <p className="text-[10px] font-mono text-white/40 mt-0.5">per query</p>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Signals Table */}
        <div className="lg:col-span-2 animate-fade-up stagger-7">
          <AgentSignalsTable signals={allSignals} />
        </div>

        {/* Activity Panel */}
        <div className="animate-fade-up stagger-8">
          <AgentActivityPanel agentId={agentId} />
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-white/[0.03] pt-6 pb-12 text-center">
        <p className="text-[10px] font-mono text-white/60">
          Built by Ethy AI — X Layer Hackathon 2026
        </p>
      </div>
    </div>
  )
}

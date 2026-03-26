export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8 animate-pulse">
      {/* Hero skeleton */}
      <div className="space-y-4">
        <div className="h-4 w-32 bg-zinc-900 rounded" />
        <div className="h-8 w-64 bg-zinc-900 rounded" />
        <div className="h-4 w-96 bg-zinc-900/60 rounded" />
      </div>
      {/* Stats skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass rounded-xl p-4 space-y-2">
            <div className="h-3 w-16 bg-zinc-900 rounded" />
            <div className="h-6 w-20 bg-zinc-900/60 rounded" />
          </div>
        ))}
      </div>
      {/* Table skeleton */}
      <div className="glass rounded-xl overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-white/[0.02]">
            <div className="h-4 w-8 bg-zinc-900 rounded" />
            <div className="h-4 w-32 bg-zinc-900/60 rounded" />
            <div className="flex-1" />
            <div className="h-4 w-16 bg-zinc-900/40 rounded" />
            <div className="h-4 w-16 bg-zinc-900/40 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

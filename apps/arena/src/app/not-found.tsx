import Link from "next/link"

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 border border-violet-500/15 mb-6">
        <span className="gradient-text-static text-2xl font-mono font-black">?</span>
      </div>
      <p className="text-[10px] font-mono text-white/40 tracking-widest uppercase mb-3">
        Signal Lost
      </p>
      <h1 className="text-3xl font-black text-white mb-3" style={{ fontFamily: "var(--font-jakarta), sans-serif" }}>
        Agent Not Found
      </h1>
      <p className="text-sm text-white/50 mb-8 max-w-sm">
        This route doesn&apos;t exist in the Arena. The agent may have been eliminated — or never entered.
      </p>
      <Link
        href="/"
        className="text-xs font-mono text-violet-400 bg-violet-500/10 border border-violet-500/15 px-5 py-2.5 rounded-lg hover:bg-violet-500/15 hover:scale-105 active:scale-[0.98] transition-all duration-300"
      >
        Back to Arena →
      </Link>
    </div>
  )
}

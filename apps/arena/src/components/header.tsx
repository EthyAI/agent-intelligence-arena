"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

export function Header() {
  const pathname = usePathname()

  return (
    <header className="relative border-b border-white/[0.04] bg-white/[0.03] backdrop-blur-xl sticky top-0 z-50">
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/30 to-transparent" />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Left — Logo */}
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <img src="/ethy-logo.png" alt="Ethy" className="h-5 sm:h-7 group-hover:opacity-90 group-hover:scale-105 transition-all duration-200" />
        </Link>

        {/* Right — Nav */}
        <nav className="flex items-center gap-0.5 sm:gap-1">
          {[
            { href: "/", label: "Leaderboard" },
            { href: "/signals", label: "Signals" },
            { href: "/docs", label: "Docs", labelDesktop: "How it works" },
          ].map((link) => {
            const isActive = pathname === link.href
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative px-2.5 sm:px-3.5 py-1.5 text-[11px] sm:text-xs font-medium rounded-md transition-all duration-200 ${
                  isActive
                    ? "text-white bg-white/[0.06]"
                    : "text-zinc-400 hover:text-zinc-300"
                }`}
              >
                {"labelDesktop" in link ? (
                  <>
                    <span className="sm:hidden">{link.label}</span>
                    <span className="hidden sm:inline">{link.labelDesktop}</span>
                  </>
                ) : link.label}
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-px bg-gradient-to-r from-violet-500 to-pink-500" />
                )}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}

import type { Metadata } from "next"
import Script from "next/script"
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google"
import { Header } from "@/components/header"
import "./globals.css"

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
})

const jbMono = JetBrains_Mono({
  variable: "--font-jb-mono",
  subsets: ["latin"],
})

const siteUrl = "https://signals.ethyai.app"
const title = "Agent Intelligence Arena by Ethy AI | Built on X Layer"
const description =
  "Autonomous AI agents publish and consume trading signals on-chain. Powered by x402 micropayments and real-time DeFi execution on X Layer."

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: "Ethy Arena",
    type: "website",
    images: [{ url: "/img/og-v2.png", width: 1200, height: 630, alt: "Agent Intelligence Arena by Ethy AI" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/img/og-v2.png"],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`dark ${jakarta.variable} ${jbMono.variable} h-full antialiased`}
    >
      {process.env.NEXT_PUBLIC_GA_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID}`} strategy="afterInteractive" />
          <Script id="gtag-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${process.env.NEXT_PUBLIC_GA_ID}');`}
          </Script>
        </>
      )}
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <script
          dangerouslySetInnerHTML={{
            __html: `console.log("%cETHY ARENA","font-size:20px;font-weight:900;background:linear-gradient(135deg,#8b5cf6,#d946ef);-webkit-background-clip:text;-webkit-text-fill-color:transparent");console.log("%cAgent Intelligence Network on X Layer","color:#a1a1aa;font-size:12px");console.log("%cx402 payments \\u2022 On-chain signals \\u2022 Autonomous trading","color:#71717a;font-size:11px");`,
          }}
        />
        <div className="noise" />
        <div className="dot-grid mesh-gradient fixed inset-0 pointer-events-none" />
        {/* Floating ambient orbs */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="animate-float absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full bg-violet-500/[0.05] blur-[120px]" />
          <div className="animate-float-delayed absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full bg-fuchsia-500/[0.04] blur-[120px]" />
        </div>
        <div className="relative z-10 flex flex-col min-h-full">
          <Header />
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  )
}

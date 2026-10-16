import type { Metadata } from 'next'
import { Archivo } from 'next/font/google'
import { Geist_Mono } from 'next/font/google'
import './globals.css'

// Brand type: variable Archivo. The width axis gives the narrow, heavy style used for
// competitor numbers and competition codes, like a printed number card.
const archivo = Archivo({
  variable: '--font-body',
  subsets: ['latin'],
  axes: ['wdth'],
  style: ['normal', 'italic'],
  display: 'swap',
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'RunFeis Pre-Registration',
  description: 'Organiser feis setup and parent registration for Irish dance competitions',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}

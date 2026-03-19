export default function OrganiserLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <>
      <nav className="feis-nav-accent bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <span className="text-xl font-bold">FeisTab</span>
          <span className="text-sm opacity-80">Pre-Registration</span>
        </div>
      </nav>
      <main className="mx-auto w-full max-w-6xl px-6 py-8">
        {children}
      </main>
    </>
  )
}

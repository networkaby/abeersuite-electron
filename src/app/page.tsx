import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col text-foreground">
      {/* Nav */}
      <header className="px-8 py-5 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <span className="font-semibold text-foreground text-lg">ServiceMgmt</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/portal/login"
            className="text-sm font-medium text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg border border-border"
          >
            Customer sign in
          </Link>
          <Link
            href="/login"
            className="bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Staff sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-8 py-24 text-center">
        <span className="inline-block bg-primary/8 text-primary text-xs font-semibold px-3 py-1 rounded-full mb-6 tracking-wide uppercase">
          Service Management System
        </span>
        <h1 className="text-5xl font-bold text-foreground max-w-2xl leading-tight mb-6">
          Manage repairs &amp; service tickets with ease
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mb-10">
          Track every device, customer, and technician in one place. From intake to handoff — nothing falls through the cracks.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/portal/login"
            className="bg-primary text-primary-foreground px-8 py-3.5 rounded-lg text-base font-semibold hover:bg-primary/90 transition-colors shadow-sm"
          >
            Customer portal →
          </Link>
          <Link
            href="/shop"
            className="px-8 py-3.5 rounded-lg text-base font-semibold border border-border hover:bg-muted/60 transition-colors"
          >
            Shop
          </Link>
          <Link
            href="/login"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            Staff dashboard
          </Link>
        </div>
      </main>

      {/* Feature strips */}
      <section className="border-t border-border bg-muted/40 px-8 py-16">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-10">
          <div className="flex flex-col gap-3">
            <div className="w-10 h-10 bg-primary/12 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="font-semibold text-foreground">Ticket Tracking</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">Create and update service tickets through every stage — received, diagnosing, repairing, ready, and returned.</p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="w-10 h-10 bg-primary/12 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h3 className="font-semibold text-foreground">Customer &amp; Device Management</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">Keep a complete record of every customer and their devices, with full history across all visits.</p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="w-10 h-10 bg-primary/12 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="font-semibold text-foreground">Role-Based Access</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">Separate views and permissions for admins, technicians, and front-desk staff — everyone sees what they need.</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-8 py-5 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} ServiceMgmt · Network Service
      </footer>
    </div>
  );
}

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShoppingBag, Truck, Shield, Sparkles, ArrowRight } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col text-foreground">
      {/* Nav */}
      <header className="px-6 sm:px-8 py-5 flex flex-wrap items-center justify-between gap-4 border-b border-border">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <span className="font-semibold text-foreground text-lg">ServiceMgmt</span>
          </Link>
          <nav className="hidden sm:flex items-center gap-1 text-sm font-medium">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/shop">Store</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/portal/login">Portal</Link>
            </Button>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="hidden sm:inline-flex" asChild>
            <Link href="/portal/login">Customer sign in</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/login">Staff sign in</Link>
          </Button>
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
          <Button size="lg" className="rounded-full px-8 shadow-md" asChild>
            <Link href="/shop">
              <ShoppingBag className="size-4 mr-2" />
              Browse the store
            </Link>
          </Button>
          <Button size="lg" variant="outline" className="rounded-full border-border px-8" asChild>
            <Link href="/portal/login">Customer portal</Link>
          </Button>
          <Button variant="link" className="text-muted-foreground" asChild>
            <Link href="/login">Staff dashboard</Link>
          </Button>
        </div>
      </main>

      {/* Ecommerce spotlight */}
      <section className="border-t border-border bg-linear-to-b from-violet-500/5 via-background to-background px-6 sm:px-8 py-20">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-stretch gap-10 lg:gap-12">
            <div className="flex-1 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">Ecommerce</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance">
                Network Shop — PCs, laptops, printers, CCTV &amp; components in ₹
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed max-w-xl">
                Sell desktops, notebooks, ink &amp; laser printers, bullet &amp; NVR kits, monitors, RAM, SSDs, PSUs, and
                Wi‑Fi upgrades — same storefront as your customer portal session when they sign in.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button size="lg" className="rounded-full gap-2" asChild>
                  <Link href="/shop#catalog">
                    Shop the catalog
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="secondary" className="rounded-full" asChild>
                  <Link href="/shop/cart">View cart</Link>
                </Button>
              </div>
            </div>
            <div className="flex-1 grid gap-4 sm:grid-cols-2">
              <Card className="border-border/80 shadow-sm bg-card/80 backdrop-blur-sm">
                <CardContent className="pt-6 pb-6 flex gap-3">
                  <Sparkles className="size-10 shrink-0 text-violet-600 dark:text-violet-400" />
                  <div>
                    <h3 className="font-semibold">Discover</h3>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      Filter by category, sort by price, and open rich PDPs with galleries &amp; specs.
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/80 shadow-sm bg-card/80 backdrop-blur-sm">
                <CardContent className="pt-6 pb-6 flex gap-3">
                  <Truck className="size-10 shrink-0 text-primary" />
                  <div>
                    <h3 className="font-semibold">Checkout</h3>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      Order summary, guest contact, and Razorpay when your keys are set — or mock pay in demo.
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/80 shadow-sm bg-card/80 backdrop-blur-sm sm:col-span-2">
                <CardContent className="pt-6 pb-6 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex gap-3 flex-1">
                    <Shield className="size-10 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <h3 className="font-semibold">Trust</h3>
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                        SSL session, cart persistence, and staff admin for catalog &amp; orders with permissions.
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" className="rounded-full shrink-0 w-full sm:w-auto" asChild>
                    <Link href="/shop/wishlist">Wishlist &amp; compare</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

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

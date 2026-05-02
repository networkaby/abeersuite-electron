import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Truck, ShieldCheck, RotateCcw, Cpu } from "lucide-react";

export default function ShopHero({ categories }: { categories: string[] }) {
    const top = categories.slice(0, 6);
    return (
        <section className="relative overflow-hidden border-b border-border/80 bg-gradient-to-br from-primary/10 via-background to-violet-500/10">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent pointer-events-none" />
            <div className="relative mx-auto max-w-6xl px-4 py-16 sm:py-24">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                    Curated for India · Prices in ₹ · GST inclusive where applicable
                </p>
                <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl text-balance">
                    Computers, printers, CCTV &amp; components — in stock for your team.
                </h1>
                <p className="mt-5 max-w-2xl text-lg text-muted-foreground leading-relaxed">
                    Laptops, desktops, ink &amp; laser printers, security cameras, NVRs, monitors, RAM, SSDs, and
                    networking. Filter by category, compare specs, wishlist, and checkout in ₹ — Razorpay when your keys
                    are configured.
                </p>
                <div className="mt-10 flex flex-wrap gap-3">
                    <Button size="lg" asChild className="rounded-full px-8 shadow-md">
                        <a href="#catalog">Browse catalog</a>
                    </Button>
                    <Button size="lg" variant="outline" asChild className="rounded-full border-border/80 bg-background/60 backdrop-blur">
                        <Link href="/portal/login">Sign in for portal</Link>
                    </Button>
                </div>
                {top.length > 0 ? (
                    <div className="mt-10 flex flex-wrap gap-2">
                        <span className="text-sm text-muted-foreground mr-2 self-center">Jump to:</span>
                        {top.map((c) => (
                            <a
                                key={c}
                                href={`#cat-${encodeURIComponent(c)}`}
                                className="rounded-full border border-border/80 bg-background/70 px-3 py-1 text-sm font-medium backdrop-blur hover:border-primary/40 hover:text-primary transition-colors"
                            >
                                {c}
                            </a>
                        ))}
                    </div>
                ) : null}
                <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                        { icon: Truck, title: "Fast dispatch", desc: "Metro fulfilment lanes" },
                        { icon: ShieldCheck, title: "Secure checkout", desc: "Razorpay & encrypted sessions" },
                        { icon: RotateCcw, title: "Clear policies", desc: "Returns per schedule & category" },
                        { icon: Cpu, title: "Parts & upgrades", desc: "Components for fleet refreshes" },
                    ].map(({ icon: Icon, title, desc }) => (
                        <li
                            key={title}
                            className="flex gap-3 rounded-2xl border border-border/60 bg-background/50 p-4 backdrop-blur-sm"
                        >
                            <Icon className="size-9 shrink-0 text-primary" aria-hidden />
                            <div>
                                <p className="font-semibold">{title}</p>
                                <p className="text-sm text-muted-foreground">{desc}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}

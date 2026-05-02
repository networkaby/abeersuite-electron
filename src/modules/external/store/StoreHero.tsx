import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Truck, ShieldCheck, RotateCcw, BadgePercent } from "lucide-react";

export default function StoreHero({ topCategories }: { topCategories: string[] }) {
    return (
        <section className="relative overflow-hidden border-b border-border/80 bg-linear-to-br from-primary/12 via-background to-violet-500/12">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,var(--tw-gradient-stops))] from-primary/25 via-transparent to-transparent" />
            <div className="pointer-events-none absolute -bottom-24 -left-24 size-72 rounded-full bg-violet-500/15 blur-3xl" />

            <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:py-20 lg:grid-cols-[1.2fr_1fr] lg:items-center">
                <div>
                    <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                        <BadgePercent className="size-3.5" />
                        Live deals · Prices in ₹ · GST inclusive
                    </span>
                    <h1 className="mt-5 max-w-2xl text-balance text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                        Computers, printers, CCTV &amp; components — delivered fast.
                    </h1>
                    <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
                        Browse thousands of curated products for your home, office and small business. Compare specs, save to
                        wishlist, and checkout securely — all in ₹.
                    </p>
                    <div className="mt-8 flex flex-wrap gap-3">
                        <Button size="lg" asChild className="rounded-full px-8 shadow-md">
                            <a href="#catalog" className="inline-flex items-center gap-2">
                                Shop the catalog
                                <ArrowRight className="size-4" />
                            </a>
                        </Button>
                        <Button size="lg" variant="outline" asChild className="rounded-full border-border/80 bg-background/60 px-6 backdrop-blur">
                            <a href="#deals">Today&rsquo;s deals</a>
                        </Button>
                    </div>
                    {topCategories.length > 0 ? (
                        <div className="mt-8 flex flex-wrap items-center gap-2">
                            <span className="mr-1 text-sm text-muted-foreground">Jump to:</span>
                            {topCategories.map((c) => (
                                <a
                                    key={c}
                                    href={`#cat-${encodeURIComponent(c)}`}
                                    className="rounded-full border border-border/80 bg-background/70 px-3 py-1 text-sm font-medium backdrop-blur transition-colors hover:border-primary/40 hover:text-primary"
                                >
                                    {c}
                                </a>
                            ))}
                        </div>
                    ) : null}
                </div>

                <ul className="grid grid-cols-2 gap-3 sm:gap-4">
                    {[
                        { icon: Truck, title: "Fast dispatch", desc: "Metro fulfilment" },
                        { icon: ShieldCheck, title: "Secure checkout", desc: "Razorpay & SSL" },
                        { icon: RotateCcw, title: "Easy returns", desc: "Per category schedule" },
                        { icon: BadgePercent, title: "Bulk pricing", desc: "Save on fleet orders" },
                    ].map(({ icon: Icon, title, desc }) => (
                        <li
                            key={title}
                            className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/70 p-4 shadow-sm backdrop-blur-sm"
                        >
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                                <Icon className="size-5" />
                            </span>
                            <div className="min-w-0">
                                <p className="font-semibold leading-tight">{title}</p>
                                <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}

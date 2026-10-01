import Link from "next/link";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    ArrowRight,
    Gift,
    Heart,
    Percent,
    ShieldCheck,
    ShoppingBag,
    Ticket,
    UserRound,
    Users,
    Wallet,
} from "lucide-react";

export default async function PortalHomePage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    const name = (session?.user as { name?: string } | undefined)?.name ?? "Customer";
    const isCustomer = kind === "customer";

    return (
        <main className="mx-auto max-w-6xl px-4 py-10 lg:py-12 space-y-6">
            <section className="relative overflow-hidden rounded-xl border border-border/70 bg-card p-6 shadow-sm lg:p-8">
                <div className="absolute inset-x-0 top-0 h-20 bg-linear-to-r from-primary/10 via-indigo-500/10 to-violet-500/10" />
                <div className="relative">
                    <Badge variant="secondary" className="mb-3 gap-1">
                        <ShieldCheck className="size-3.5 text-emerald-600" />
                        Secure customer portal
                    </Badge>
                    <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">
                        {isCustomer ? `Welcome back, ${name}.` : "Customer portal"}
                    </h1>
                    <p className="mt-2 max-w-2xl text-sm text-muted-foreground lg:text-base">
                        Track repair tickets, switch personal or company profiles, and manage your account security from one place.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-3">
                        {isCustomer ? (
                            <>
                                <Button asChild className="gap-1.5">
                                    <Link href="/portal/repairs">
                                        <Ticket className="size-4" />
                                        My Repairs
                                    </Link>
                                </Button>
                                <Button variant="outline" asChild className="gap-1.5">
                                    <Link href="/shop">
                                        <ShoppingBag className="size-4" />
                                        Shop
                                    </Link>
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button asChild className="gap-1.5">
                                    <Link href="/login">
                                        Sign in
                                        <ArrowRight className="size-4" />
                                    </Link>
                                </Button>
                                <Button variant="outline" asChild>
                                    <Link href="/portal/register">Create portal account</Link>
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </section>

            {isCustomer ? (
                <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <PortalCard href="/portal/orders" icon={ShoppingBag} title="My Orders" desc="Track purchases and statuses." />
                    <PortalCard href="/portal/repairs" icon={Ticket} title="My Repairs" desc="Follow service and repair progress." />
                    <PortalCard href="/portal/social" icon={Users} title="Social" desc="Join and connect with the customer network." />
                    <PortalCard href="/portal/coupons" icon={Percent} title="My Coupons" desc="View available discount offers." />
                    <PortalCard href="/portal/wallet" icon={Wallet} title="My Wallet" desc="Check wallet balance and transactions." />
                    <PortalCard href="/portal/wishlist" icon={Heart} title="Wishlist" desc="Saved items ready to buy." />
                    <PortalCard href="/portal/profile" icon={UserRound} title="My Profile" desc="Photo, details, contacts and the profile you shop with." />
                    <Card className="border-dashed border-border/70 sm:col-span-2 xl:col-span-2">
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Gift className="size-4 text-primary" />
                                More coming in phase 2
                            </CardTitle>
                            <CardDescription>Live backend integrations for wallet, coupons, social posting, and order actions.</CardDescription>
                        </CardHeader>
                    </Card>
                </section>
            ) : null}
        </main>
    );
}

function PortalCard({
    href,
    icon: Icon,
    title,
    desc,
}: {
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    desc: string;
}) {
    return (
        <Link href={href} className="group">
            <Card className="h-full border-border/70 transition hover:border-primary/35 hover:shadow-sm">
                <CardContent className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="font-semibold tracking-tight">{title}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                        </div>
                        <Icon className="size-4 shrink-0 text-primary/80" />
                    </div>
                    <p className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary">
                        Open
                        <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
                    </p>
                </CardContent>
            </Card>
        </Link>
    );
}

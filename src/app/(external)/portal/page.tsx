import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import PortalPushCard from "@/modules/external/pwa/PortalPushCard";
import {
    ArrowRight,
    Heart,
    Percent,
    ShoppingBag,
    Ticket,
    UserRound,
    Users,
    Wallet,
} from "lucide-react";

/**
 * Customer portal home. Signed-out visitors go straight to sign-in. Right after
 * signing in (`?welcome=1`, the sign-in default) the customer picks between
 * shopping and the portal; any later visit shows the portal tiles.
 */
export default async function PortalHomePage({
    searchParams,
}: {
    searchParams: Promise<{ welcome?: string }>;
}) {
    const session = await auth();
    const user = session?.user as { kind?: string; name?: string } | undefined;
    if (user?.kind !== "customer") redirect("/login");
    const name = user.name ?? "Customer";
    const { welcome } = await searchParams;

    if (welcome) {
        return (
            <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-10">
                <Card className="w-full border-border/70">
                    <CardContent className="space-y-5 p-6 text-center lg:p-8">
                        <div>
                            <h1 className="text-2xl font-semibold tracking-tight">Welcome, {name}.</h1>
                            <p className="mt-2 text-sm text-muted-foreground">Where would you like to go?</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Button asChild size="lg" className="gap-1.5">
                                <Link href="/shop">
                                    <ShoppingBag className="size-4" />
                                    Continue shopping
                                </Link>
                            </Button>
                            <Button asChild size="lg" variant="outline" className="gap-1.5">
                                <Link href="/portal">
                                    <UserRound className="size-4" />
                                    Go to my portal
                                </Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </main>
        );
    }

    return (
        <main className="mx-auto max-w-6xl px-4 py-10 lg:py-12 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">Welcome back, {name}.</h1>
                <Button variant="outline" asChild className="gap-1.5">
                    <Link href="/shop">
                        <ShoppingBag className="size-4" />
                        Shop
                    </Link>
                </Button>
            </div>
            <PortalPushCard compact />
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <PortalCard href="/portal/orders" icon={ShoppingBag} title="My Orders" desc="Track purchases and statuses." />
                <PortalCard href="/portal/repairs" icon={Ticket} title="My Repairs" desc="Follow service and repair progress." />
                <PortalCard href="/portal/social" icon={Users} title="Social" desc="Join and connect with the customer network." />
                <PortalCard href="/portal/coupons" icon={Percent} title="My Coupons" desc="View available discount offers." />
                <PortalCard href="/portal/wallet" icon={Wallet} title="My Wallet" desc="Check wallet balance and transactions." />
                <PortalCard href="/portal/wishlist" icon={Heart} title="Wishlist" desc="Saved items ready to buy." />
                <PortalCard href="/portal/profile" icon={UserRound} title="My Profile" desc="Photo, details, contacts and the profile you shop with." />
            </section>
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

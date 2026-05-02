import Link from "next/link";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PortalAccountSwitcher from "@/modules/external/portal/PortalAccountSwitcher";
import PortalPasswordCard from "@/modules/external/portal/PortalPasswordCard";
import { ArrowRight, ShieldCheck, ShoppingBag, Ticket } from "lucide-react";

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
                                    <Link href="/portal/tickets">
                                        <Ticket className="size-4" />
                                        My tickets
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
                                    <Link href="/portal/login">
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
                <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
                    <PortalAccountSwitcher />
                    <PortalPasswordCard />
                </div>
            ) : null}
            <p className="text-xs text-muted-foreground px-1">
                Staff sign-in: <Link className="underline" href="/login">/login</Link>
            </p>
        </main>
    );
}

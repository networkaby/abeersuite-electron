"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { signOutTo } from "@/shared/lib/auth/signOutTo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";

export default function PortalHeader() {
    const { data: session, status } = useSession();
    const pathname = usePathname();
    const isCustomer = (session?.user as { kind?: string } | undefined)?.kind === "customer";
    const navClass = (href: string) =>
        [
            "rounded-md px-2.5 py-1.5 transition-colors",
            pathname === href ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
        ].join(" ");

    return (
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/75">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
                <nav className="flex items-center gap-2 text-sm font-medium">
                    <Link href="/portal" className={navClass("/portal")}>
                        Home
                    </Link>
                    <Link href="/shop" className={navClass("/shop")}>
                        Shop
                    </Link>
                    {isCustomer ? (
                        <Link href="/portal/repairs" className={navClass("/portal/repairs")}>
                            My Repairs
                        </Link>
                    ) : null}
                </nav>
                <div className="flex items-center gap-2">
                    {isCustomer ? (
                        <Badge variant="secondary" className="hidden sm:inline-flex gap-1">
                            <ShieldCheck className="size-3.5" />
                            Verified customer
                        </Badge>
                    ) : null}
                    {status === "authenticated" && isCustomer ? (
                        <Button variant="outline" size="sm" type="button" onClick={() => void signOutTo("/shop")}>
                            Sign out
                        </Button>
                    ) : (
                        <>
                            <Button variant="ghost" size="sm" asChild>
                                <Link href="/login">Sign in</Link>
                            </Button>
                            <Button size="sm" asChild>
                                <Link href="/portal/register">Register</Link>
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </header>
    );
}

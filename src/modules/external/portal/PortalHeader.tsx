"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

export default function PortalHeader() {
    const { data: session, status } = useSession();
    const isCustomer = (session?.user as { kind?: string } | undefined)?.kind === "customer";

    return (
        <header className="border-b border-border bg-background px-4 py-3 flex items-center justify-between gap-4">
            <nav className="flex items-center gap-4 text-sm font-medium">
                <Link href="/portal" className="text-foreground hover:underline">
                    Home
                </Link>
                <Link href="/shop" className="text-muted-foreground hover:text-foreground">
                    Shop
                </Link>
                {isCustomer ? (
                    <Link href="/portal/tickets" className="text-muted-foreground hover:text-foreground">
                        My tickets
                    </Link>
                ) : null}
            </nav>
            <div className="flex items-center gap-2">
                {status === "authenticated" && isCustomer ? (
                    <Button variant="outline" size="sm" type="button" onClick={() => signOut({ callbackUrl: "/portal" })}>
                        Sign out
                    </Button>
                ) : (
                    <>
                        <Button variant="ghost" size="sm" asChild>
                            <Link href="/portal/login">Sign in</Link>
                        </Button>
                        <Button size="sm" asChild>
                            <Link href="/portal/register">Register</Link>
                        </Button>
                    </>
                )}
            </div>
        </header>
    );
}

import Link from "next/link";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import PortalAccountSwitcher from "@/modules/external/portal/PortalAccountSwitcher";
import PortalPasswordCard from "@/modules/external/portal/PortalPasswordCard";

export default async function PortalHomePage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    const isCustomer = kind === "customer";

    return (
        <main className="mx-auto max-w-2xl px-4 py-12 space-y-6">
            <h1 className="text-2xl font-semibold">Customer portal</h1>
            <p className="text-muted-foreground">
                Sign in to track service tickets linked to your account, or browse the shop.
            </p>
            <div className="flex flex-wrap gap-3">
                {isCustomer ? (
                    <>
                        <Button asChild>
                            <Link href="/portal/tickets">My tickets</Link>
                        </Button>
                        <Button variant="outline" asChild>
                            <Link href="/shop">Shop</Link>
                        </Button>
                    </>
                ) : (
                    <>
                        <Button asChild>
                            <Link href="/portal/login">Sign in</Link>
                        </Button>
                        <Button variant="outline" asChild>
                            <Link href="/portal/register">Create portal account</Link>
                        </Button>
                    </>
                )}
            </div>
            {isCustomer ? (
                <div className="space-y-4 rounded-lg border border-border p-4">
                    <PortalAccountSwitcher />
                    <PortalPasswordCard />
                </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
                Staff sign-in: <Link className="underline" href="/login">/login</Link>
            </p>
        </main>
    );
}

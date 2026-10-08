import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import PortalOrderCard from "@/modules/external/portal/PortalOrderCard";
import { loadPortalOrders } from "@/modules/external/portal/portalOrders";
import { ShoppingBag } from "lucide-react";

// The customer's REAL orders across every profile they belong to (personal +
// linked company accounts) — an order is a Ticket (flavour "order") +
// TicketOrder detail. Each card expands IN PLACE (details / timeline) and the
// posted ONLINE_INVOICE downloads as an A4 PDF via the print-template view.

export default async function PortalOrdersPage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    const customerId = Number((session?.user as { id?: string | number } | undefined)?.id);
    if (!session?.user || kind !== "customer" || !Number.isFinite(customerId)) {
        redirect("/login?callbackUrl=/portal/orders");
    }

    const dtos = await loadPortalOrders(customerId);

    return (
        <main className="px-3 py-4 sm:px-4 sm:py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-5xl space-y-5">
                <PortalSectionHeader
                    title="My Orders"
                    description="Track your purchases across personal and company profiles."
                    icon={ShoppingBag}
                    rightSlot={<Button variant="outline" asChild><Link href="/shop">New order</Link></Button>}
                />

                {dtos.length === 0 ? (
                    <Card>
                        <CardContent className="py-14 text-center text-sm text-muted-foreground">
                            No online orders yet.{" "}
                            <Link href="/shop" className="text-primary underline">Browse the shop</Link> to place your first one.
                            <div className="mt-2">
                                Bought at our counter? Your bills are under{" "}
                                <Link href="/portal/bills" className="text-primary underline">My Bills</Link>.
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-3">
                        {dtos.map((o) => (
                            <PortalOrderCard key={o.id} order={o} />
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}

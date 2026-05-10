import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getMockOrders } from "@/shared/lib/portal/mockAdapters";
import { formatRupees } from "@/shared/lib/format/moneyInr";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import { ShoppingBag } from "lucide-react";

export default async function PortalOrdersPage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    if (!session?.user || kind !== "customer") {
        redirect("/login?callbackUrl=/portal/orders");
    }

    // Phase 2 contract: replace with real orders API bound to active account context.
    const orders = await getMockOrders();

    return (
        <main className="px-4 py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-5xl space-y-5">
                <PortalSectionHeader
                    title="My Orders"
                    description="Track your purchases across personal and company profiles."
                    icon={ShoppingBag}
                    rightSlot={<Button variant="outline" asChild><a href="/shop">New order</a></Button>}
                />

                {orders.length === 0 ? (
                    <Card>
                        <CardContent className="py-14 text-center text-sm text-muted-foreground">No orders yet.</CardContent>
                    </Card>
                ) : (
                    <div className="space-y-3">
                        {orders.map((order) => (
                            <Card key={order.id} className="border-border/70">
                                <CardContent className="p-4 sm:p-5">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <p className="font-medium">{order.orderNo}</p>
                                            <p className="text-xs text-muted-foreground">{order.createdAt} · {order.accountLabel}</p>
                                        </div>
                                        <Badge variant="secondary">{order.status}</Badge>
                                    </div>
                                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                                        <div>
                                            <p className="text-xs text-muted-foreground">Amount</p>
                                            <p className="font-medium">{formatRupees(order.amountInr)}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground">Items</p>
                                            <p className="font-medium">{order.items}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground">Support</p>
                                            <p className="font-medium">Available</p>
                                        </div>
                                        <div className="flex items-end justify-end">
                                            <Button size="sm" variant="ghost">View details</Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}


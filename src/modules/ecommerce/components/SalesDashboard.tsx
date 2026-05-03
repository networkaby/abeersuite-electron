import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRupeesFromPaise } from "@/lib/money-inr";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export type SalesDashboardProps = {
    revenue7dPaise: number;
    revenue30dPaise: number;
    pendingPaymentCount: number;
    fulfilmentQueueCount: number;
    lowStock: { id: number; name: string; stock: number }[];
};

export default function SalesDashboard({
    revenue7dPaise,
    revenue30dPaise,
    pendingPaymentCount,
    fulfilmentQueueCount,
    lowStock,
}: SalesDashboardProps) {
    return (
        <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Revenue (7 days)</CardDescription>
                        <CardTitle className="text-2xl">{formatRupeesFromPaise(revenue7dPaise)}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">Paid orders · recorded in journal</CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Revenue (30 days)</CardDescription>
                        <CardTitle className="text-2xl">{formatRupeesFromPaise(revenue30dPaise)}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">Shop orders with payment</CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Awaiting payment</CardDescription>
                        <CardTitle className="text-2xl">{pendingPaymentCount}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Button variant="outline" size="sm" asChild>
                            <Link href="/office/ecommerce/orders?status=PENDING_PAYMENT">View queue</Link>
                        </Button>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>To fulfil</CardDescription>
                        <CardTitle className="text-2xl">{fulfilmentQueueCount}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">Paid / packed / shipping</CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Low stock</CardTitle>
                    <CardDescription>Tracked SKU at or below threshold</CardDescription>
                </CardHeader>
                <CardContent>
                    {lowStock.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nothing flagged.</p>
                    ) : (
                        <ul className="divide-y divide-border rounded-md border border-border">
                            {lowStock.map((p) => (
                                <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                                    <Link href={`/office/ecommerce/products/${p.id}`} className="font-medium hover:text-primary">
                                        {p.name}
                                    </Link>
                                    <span className="text-muted-foreground">{p.stock} left</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

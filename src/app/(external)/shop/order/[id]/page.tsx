import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatRupeesFromPaise } from "@/lib/money-inr";
import { Button } from "@/components/ui/button";

export default async function ShopOrderConfirmationPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ mock?: string }>;
}) {
    const { id } = await params;
    const sp = await searchParams;
    const orderId = parseInt(id, 10);
    if (!Number.isFinite(orderId)) {
        return (
            <main className="mx-auto max-w-lg px-4 py-8">
                <p>Invalid order.</p>
            </main>
        );
    }

    const order = await prisma.shopOrder.findUnique({
        where: { id: orderId },
        include: {
            lines: { include: { product: { select: { name: true } } } },
        },
    });

    if (!order) {
        return (
            <main className="mx-auto max-w-lg px-4 py-8">
                <p>Order not found.</p>
            </main>
        );
    }

    return (
        <main className="mx-auto max-w-lg px-4 py-8 space-y-4">
            <h1 className="text-2xl font-semibold">Order #{order.id}</h1>
            <p className="text-muted-foreground">Status: {order.status}</p>
            {sp.mock === "1" ? (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                    Razorpay keys are not configured — this was a mock checkout. Configure{" "}
                    <code className="text-xs">RAZORPAY_KEY_ID</code> / <code className="text-xs">RAZORPAY_KEY_SECRET</code>{" "}
                    for live payments.
                </p>
            ) : null}
            <ul className="text-sm space-y-1 border border-border rounded-lg p-3">
                {order.lines.map((l) => (
                    <li key={l.id} className="flex justify-between gap-2">
                        <span>
                            {l.product.name} × {l.quantity}
                        </span>
                        <span>{formatRupeesFromPaise(l.unitPricePaise * l.quantity)}</span>
                    </li>
                ))}
            </ul>
            <p className="font-semibold">Total paid / due: {formatRupeesFromPaise(order.totalPaise)}</p>
            <Button variant="outline" asChild>
                <Link href="/shop">Continue shopping</Link>
            </Button>
        </main>
    );
}

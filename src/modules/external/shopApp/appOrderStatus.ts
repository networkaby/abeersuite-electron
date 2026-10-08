import type { PortalOrderDto } from "@/modules/external/portal/portalOrderTypes";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** The one line an order card leads with, the way shopping apps say it. */
export function orderHeadline(o: PortalOrderDto): { text: string; tone: string } {
    if (o.statusId === "S48") return { text: "Cancelled", tone: "text-destructive" };
    if (o.statusId === "S49") return { text: "Returned", tone: "text-muted-foreground" };
    if (o.deliveredAt) return { text: `Delivered on ${day(o.deliveredAt)}`, tone: "text-emerald-700" };
    if (o.awaitingPayment) return { text: "Payment pending", tone: "text-amber-700" };
    if (o.shippedAt) return { text: `On the way · shipped ${day(o.shippedAt)}`, tone: "text-primary" };
    return { text: o.statusLabel ?? "Order placed", tone: "text-foreground" };
}

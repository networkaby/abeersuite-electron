import { Percent, Sparkles } from "lucide-react";
import type { PortalCoupon } from "@/modules/external/portal/portalCoupons";
import { formatRupees } from "@/shared/lib/format/moneyInr";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** The coupons a profile can use — ticket-style cards. The portal and the customer app share it. */
export default function PortalCouponList({ coupons }: { coupons: PortalCoupon[] }) {
    if (coupons.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed bg-background px-6 py-12 text-center">
                <p className="font-medium">No coupons right now</p>
                <p className="mt-1 text-sm text-muted-foreground">New offers and rewards you earn will show up here.</p>
            </div>
        );
    }
    return (
        <ul className="grid gap-3 md:grid-cols-2">
            {coupons.map((c) => (
                <li key={c.id} className="flex overflow-hidden rounded-2xl border bg-background">
                    <span className={`flex w-16 shrink-0 items-center justify-center ${c.mine ? "bg-amber-400 text-amber-950" : "bg-primary text-primary-foreground"}`}>
                        {c.code ? <Percent className="size-6" /> : <Sparkles className="size-6" />}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1 border-l border-dashed p-3">
                        <p className="text-[15px] font-semibold">{c.benefit}</p>
                        <p className="text-sm">{c.title}</p>
                        {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
                            {c.code ? (
                                <span className="rounded-md border border-dashed border-primary/60 px-2 py-0.5 font-mono text-xs font-semibold text-primary">{c.code}</span>
                            ) : (
                                <span className="font-medium text-emerald-700">Applies by itself at checkout</span>
                            )}
                            {c.mine && <span className="font-medium text-amber-700">Just for you</span>}
                            {c.minBill != null && <span>On orders above {formatRupees(c.minBill)}</span>}
                            {c.usesLeft != null && <span>{c.usesLeft} use{c.usesLeft === 1 ? "" : "s"} left</span>}
                            {c.forWhom && <span>{c.forWhom}</span>}
                            <span>{c.endsAt ? `Valid till ${day(c.endsAt)}` : "No end date"}</span>
                        </div>
                    </div>
                </li>
            ))}
        </ul>
    );
}

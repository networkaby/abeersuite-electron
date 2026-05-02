import { Truck, RotateCcw, Headphones, ShieldCheck } from "lucide-react";
import { COMPANY_DETAILS } from "@/utils/constants-company-details";
import { formatRupeesFromPaise } from "@/lib/money-inr";

export default function TrustStrip() {
    const items = [
        {
            icon: Truck,
            title: "Free shipping",
            desc: `Orders over ${formatRupeesFromPaise(COMPANY_DETAILS.policies.freeShippingMinPaise)}`,
        },
        {
            icon: RotateCcw,
            title: "Easy returns",
            desc: `${COMPANY_DETAILS.policies.returnWindowDays}-day window`,
        },
        {
            icon: Headphones,
            title: "24×7 support",
            desc: COMPANY_DETAILS.contact.phone,
        },
        {
            icon: ShieldCheck,
            title: "Secure checkout",
            desc: "Razorpay · 100% safe",
        },
    ];

    return (
        <section className="border-b border-border/60 bg-muted/30">
            <ul className="mx-auto grid max-w-6xl grid-cols-2 divide-y divide-border/60 px-4 py-3 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                {items.map(({ icon: Icon, title, desc }) => (
                    <li key={title} className="flex items-center gap-3 py-2 sm:px-4 sm:py-1">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
                            <Icon className="size-4" />
                        </span>
                        <div className="min-w-0 leading-tight">
                            <p className="text-sm font-semibold">{title}</p>
                            <p className="truncate text-xs text-muted-foreground">{desc}</p>
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}

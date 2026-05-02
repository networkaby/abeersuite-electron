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
            <ul className="mx-auto flex max-w-6xl snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-4 [-webkit-overflow-scrolling:touch] sm:grid sm:grid-cols-4 sm:gap-0 sm:overflow-visible sm:divide-x sm:divide-border/60 sm:px-4 sm:py-3">
                {items.map(({ icon: Icon, title, desc }) => (
                    <li
                        key={title}
                        className="flex min-w-[min(78vw,220px)] shrink-0 snap-start items-center gap-3 rounded-xl border border-border/50 bg-background/80 px-4 py-3 sm:min-w-0 sm:snap-none sm:border-0 sm:bg-transparent sm:py-2 sm:first:pl-0 sm:last:pr-4"
                    >
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary sm:size-9">
                            <Icon className="size-4 sm:size-4" />
                        </span>
                        <div className="min-w-0 leading-tight">
                            <p className="text-sm font-semibold">{title}</p>
                            <p className="line-clamp-2 text-xs text-muted-foreground sm:truncate sm:line-clamp-none">{desc}</p>
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}

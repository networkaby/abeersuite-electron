import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { TRUST_ICON_MAP } from "./trustIcons";
import type { TrustContentItem } from "@/shared/lib/shop/homeLayout";

/** Also imported by the Customize Home editor to seed/reset the picker. */
export const DEFAULT_TRUST_ITEMS: TrustContentItem[] = [
    {
        icon: "truck",
        title: "Free shipping",
        desc: `Orders over ${formatRupeesFromPaise(COMPANY_DETAILS.policies.freeShippingMinPaise)}`,
    },
    {
        icon: "returns",
        title: "Easy returns",
        desc: `${COMPANY_DETAILS.policies.returnWindowDays}-day window`,
    },
    {
        icon: "support",
        title: "24×7 support",
        desc: COMPANY_DETAILS.contact.phone,
    },
    {
        icon: "shield",
        title: "Secure checkout",
        desc: "Razorpay · 100% safe",
    },
];

export default function TrustStrip({ items }: { items?: TrustContentItem[] }) {
    const rows = items && items.length > 0 ? items : DEFAULT_TRUST_ITEMS;

    return (
        <section className="border-b border-border/60 bg-muted/30">
            <ul className="mx-auto flex max-w-6xl snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-4 [-webkit-overflow-scrolling:touch] sm:grid sm:grid-cols-4 sm:gap-0 sm:overflow-visible sm:divide-x sm:divide-border/60 sm:px-4 sm:py-3">
                {rows.map(({ icon, title, desc }, i) => {
                    const Icon = TRUST_ICON_MAP[icon] ?? TRUST_ICON_MAP.shield;
                    return (
                        <li
                            key={`${icon}-${i}`}
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
                    );
                })}
            </ul>
        </section>
    );
}

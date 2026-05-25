import Link from "next/link";
import { ChartArea, Calculator, Boxes } from "lucide-react";

const NAV = [
    { label: "Overview",   icon: ChartArea,  href: "/office/pricing-strategy" },
    { label: "Strategies", icon: Calculator, href: "/office/pricing-strategy/strategies" },
    { label: "Items",      icon: Boxes,      href: "/office/pricing-strategy/items" },
];

export default function PricingStrategyLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="w-full px-6 py-6 space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Pricing Strategy</h1>
                <p className="text-muted-foreground text-sm">
                    Cost + margin → sale price. Formula default with per-SKU manual override.
                </p>
            </div>
            <nav
                className="flex flex-wrap gap-2 border-b-2 border-border pb-4"
                aria-label="Pricing strategy sections"
            >
                {NAV.map(({ href, label, icon: Icon }) => (
                    <Link
                        key={href}
                        href={href}
                        className="inline-flex items-center gap-2 border-2 border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                    >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        {label}
                    </Link>
                ))}
            </nav>
            {children}
        </div>
    );
}

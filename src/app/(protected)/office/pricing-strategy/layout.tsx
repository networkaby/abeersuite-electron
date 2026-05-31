import Link from "next/link";
import { ChartArea, Calculator, Boxes, AlertTriangle, Printer } from "lucide-react";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

const NAV = [
    { label: "Overview", icon: ChartArea, href: "/office/pricing-strategy" },
    { label: "Strategies", icon: Calculator, href: "/office/pricing-strategy/strategies" },
    { label: "Items", icon: Boxes, href: "/office/pricing-strategy/items" },
    { label: "Needs attention", icon: AlertTriangle, href: "/office/pricing-strategy/needs-attention" },
    { label: "Update & print labels", icon: Printer, href: "/office/pricing-strategy/update-print-labels" },
];

export default function PricingStrategyLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full w-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/pricing-strategy", label: "Pricing Strategy" }}
                labels={{
                    "items": "Items",
                    "strategies": "Strategies",
                    "needs-attention": "Needs Attention",
                    "update-print-labels": "Update & Print Labels",
                    "create": "Create",
                }}
            />
            {/* <nav
                className="flex flex-none flex-wrap gap-2 border-b border-border px-6 pb-2 mb-3"
                aria-label="Pricing strategy sections"
            >
                {NAV.map(({ href, label, icon: Icon }) => (
                    <Link
                        key={href}
                        href={href}
                        className="inline-flex items-center gap-2 border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted rounded-sm"
                    >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        {label}
                    </Link>
                ))}
            </nav> */}
            <div className="min-h-0 flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}

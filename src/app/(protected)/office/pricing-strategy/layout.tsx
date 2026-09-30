import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

export default function PricingStrategyLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full w-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/pricing-strategy", label: "Pricing Strategy" }}
                escapeBack
                labels={{
                    "strategies": "Strategies",
                    "costing": "Costing",
                    "needs-attention": "Needs attention",
                    "group-pricing": "Group pricing",
                    "update-print-labels": "Update prices",
                    "print-labels": "Print Labels",
                }}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}

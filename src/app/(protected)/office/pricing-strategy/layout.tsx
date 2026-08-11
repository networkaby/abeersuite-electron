import { redirect } from "next/navigation";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";
import { auth } from "@/auth";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";

export default async function PricingStrategyLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    // View is granted by any Pricing Strategy sidebar nav grant; inventory:manage
    // (the module's historical umbrella) also passes. Per-page edit rights are
    // enforced inside each tool, not here.
    if (!hasModuleNavAccess(perms, "pricing-strategy")) {
        redirect("/office");
    }
    return (
        <div className="flex h-full w-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/pricing-strategy", label: "Pricing Strategy" }}
                escapeBack
                labels={{
                    "items": "Items",
                    "strategies": "Strategies",
                    "costing": "Costing",
                    "needs-attention": "Needs Attention",
                    "update-print-labels": "Update & Print Labels",
                    "print-labels": "Print Labels",
                }}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}

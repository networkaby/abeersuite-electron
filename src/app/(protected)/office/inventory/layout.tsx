import { auth } from "@/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChartArea, Box, Layers, LayoutGrid, Tag, ShieldCheck, Ruler, BookOpen, BarChart3 } from "lucide-react";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const links = [
    { href: "/office/inventory", label: "Overview", icon: ChartArea },
    { href: "/office/inventory/units", label: "Units", icon: Ruler },
    { href: "/office/inventory/categories", label: "Categories", icon: Layers },
    { href: "/office/inventory/product-groups", label: "Groups", icon: LayoutGrid },
    { href: "/office/inventory/brands", label: "Brands", icon: Tag },
    { href: "/office/inventory/warranty-terms", label: "Warranty terms", icon: ShieldCheck },
    { href: "/office/inventory/products", label: "Products", icon: Box },
    { href: "/office/inventory/stock-ledger", label: "Stock Ledger", icon: BookOpen },
    { href: "/office/inventory/stock-summary", label: "Stock Summary", icon: BarChart3 },
] as const;

export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!permissions.includes(PERMISSIONS.ADMIN_BYPASS) && !permissions.includes(PERMISSIONS.INVENTORY_MANAGE)) {
        redirect("/office/core/assignments");
    }

    return (
        <div className="container max-w-7xl py-6 space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
                <p className="text-muted-foreground text-sm">Master data and stock ledger. Purchases &amp; sales are under Tally.</p>
            </div>
            <nav className="flex flex-wrap gap-2 border-b-2 border-border pb-4" aria-label="Inventory sections">
                {links.map(({ href, label, icon: Icon }) => (
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

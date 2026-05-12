import { auth } from "@/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChartArea, Box, Layers, LayoutGrid, Tag, ShieldCheck, Ruler, ListChecks, Wand2 } from "lucide-react";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const masterLinks = [
    { href: "/office/inventory/configure/units",            label: "Units",             icon: Ruler },
    { href: "/office/inventory/configure/categories",       label: "Categories",        icon: Layers },
    { href: "/office/inventory/configure/product-groups",   label: "Groups",            icon: LayoutGrid },
    { href: "/office/inventory/configure/brands",           label: "Brands",            icon: Tag },
    { href: "/office/inventory/configure/warranty-terms",   label: "Warranty terms",    icon: ShieldCheck },
    { href: "/office/inventory/configure/products",         label: "Products",          icon: Box },
    { href: "/office/inventory/configure/attribute-masters", label: "Attribute masters", icon: ListChecks },
] as const;

const configLinks = [
    { href: "/office/inventory/configure/naming-convention", label: "Naming convention", icon: Wand2 },
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
            <nav className="space-y-2 border-b-2 border-border pb-4" aria-label="Inventory sections">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[72px]">Masters</span>
                    {masterLinks.map(({ href, label, icon: Icon }) => (
                        <Link
                            key={href}
                            href={href}
                            className="inline-flex items-center gap-2 border-2 border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                        >
                            <Icon className="size-4 shrink-0" aria-hidden />
                            {label}
                        </Link>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[72px]">Configuration</span>
                    {configLinks.map(({ href, label, icon: Icon }) => (
                        <Link
                            key={href}
                            href={href}
                            className="inline-flex items-center gap-2 border-2 border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                        >
                            <Icon className="size-4 shrink-0" aria-hidden />
                            {label}
                        </Link>
                    ))}
                </div>
            </nav>
            {children}
        </div>
    );
}

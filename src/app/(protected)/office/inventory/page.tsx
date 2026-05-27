import Link from "next/link";
import { Box, Layers, LayoutGrid, Ruler, ShieldCheck, Tag } from "lucide-react";

const cards = [
    {
        title: "Units",
        href: "/office/inventory/units",
        description: "Measurement units (PCS, KG, …).",
        icon: Ruler,
    },
    {
        title: "Categories",
        href: "/office/inventory/categories",
        description: "Product categories (optional hierarchy).",
        icon: Layers,
    },
    {
        title: "Groups",
        href: "/office/inventory/product-groups",
        description: "Classification groups for items.",
        icon: LayoutGrid,
    },
    {
        title: "Brands",
        href: "/office/inventory/brands",
        description: "Brand names.",
        icon: Tag,
    },
    {
        title: "Warranty terms",
        href: "/office/inventory/warranty-terms",
        description: "Shelf warranty policies for masters.",
        icon: ShieldCheck,
    },
    {
        title: "Products",
        href: "/office/inventory/products",
        description: "SKU master: model no., barcodes, EAN, UPC.",
        icon: Box,
    },
] as const;

export default function InventoryOverviewPage() {
    return (
        <div className="space-y-4 p-6">
            <p className="text-muted-foreground text-sm">Choose a master list to create or edit records.</p>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cards.map(({ title, href, description, icon: Icon }) => (
                    <li key={href}>
                        <Link
                            href={href}
                            className="flex h-full flex-col gap-2 border-2 border-border bg-card p-4 transition-colors hover:bg-muted"
                        >
                            <span className="flex items-center gap-2 font-semibold">
                                <Icon className="size-5 shrink-0" aria-hidden />
                                {title}
                            </span>
                            <span className="text-muted-foreground text-sm">{description}</span>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}

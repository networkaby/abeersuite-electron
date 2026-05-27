import Link from "next/link";
import { Box, Layers, LayoutGrid, ListChecks, Percent, Ruler, ShieldCheck, Tag, Workflow } from "lucide-react";

const masterCards = [
    { title: "Units", href: "/office/inventory/masters/units", description: "Measurement units (PCS, KG, …).", icon: Ruler },
    { title: "Categories", href: "/office/inventory/masters/categories", description: "Product categories (optional hierarchy).", icon: Layers },
    { title: "Groups", href: "/office/inventory/masters/product-groups", description: "Classification groups for items.", icon: LayoutGrid },
    { title: "Brands", href: "/office/inventory/masters/brands", description: "Brand names.", icon: Tag },
    { title: "Warranty terms", href: "/office/inventory/masters/warranty-terms", description: "Shelf warranty policies for masters.", icon: ShieldCheck },
    { title: "Products", href: "/office/inventory/products", description: "SKU master: model no., barcodes, EAN, UPC.", icon: Box },
    { title: "Attribute masters", href: "/office/inventory/masters/attribute-masters", description: "Define custom attribute keys (RAM, Storage, OS…) per category.", icon: ListChecks },
    { title: "GST Rates", href: "/office/inventory/masters/gst-rates", description: "GST rate slabs for tax classification.", icon: Percent },
    { title: "BOMs", href: "/office/inventory/masters/boms", description: "Bill of materials — raw materials and finished goods.", icon: Workflow },
] as const;

function CardGrid({ cards }: { cards: readonly { title: string; href: string; description: string; icon: React.ElementType }[] }) {
    return (
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
    );
}

export default function InventoryOverviewPage() {
    return (
        <section className="space-y-3 p-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Masters</h2>
            <CardGrid cards={masterCards} />
        </section>
    );
}

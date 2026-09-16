import Link from "next/link";
import { INVENTORY_MASTERS_NAV_GROUPS } from "@/modules/inventory/masters-nav";
import { moduleColor, moduleTint } from "@/shared/lib/format/moduleTheme";

// Card copy, keyed by href. This is the only thing the hub owns — the links,
// labels and icons come from INVENTORY_MASTERS_NAV_GROUPS, the same list that
// drives the masters tab strip.
//
// This page used to carry its own hand-written `cards` array, and it had drifted:
// five of its six links pointed at /office/inventory/<slug> when the real routes
// are /office/inventory/masters/<slug>, so five of six cards 404'd. Reading the
// shared list fixes that permanently and picks up the three masters the hub never
// listed (Attribute masters, GST Rates, BOMs).
//
// A master with no entry here simply renders without a description, so adding a
// tenth one needs no edit in this file.
const DESCRIPTIONS: Record<string, string> = {
    "/office/inventory/masters/units": "Measurement units (PCS, KG, …).",
    "/office/inventory/masters/categories": "Product categories (optional hierarchy).",
    "/office/inventory/masters/product-groups": "Classification groups for items.",
    "/office/inventory/masters/brands": "Brand names.",
    "/office/inventory/masters/warranty-terms": "Shelf warranty policies for masters.",
    "/office/inventory/products": "SKU master: model no., barcodes, EAN, UPC.",
    "/office/inventory/masters/attribute-masters": "Size, colour and the other item attributes.",
    "/office/inventory/masters/gst-rates": "Tax rates applied to items.",
    "/office/inventory/masters/boms": "Bills of material for assembled items.",
};

const cards = INVENTORY_MASTERS_NAV_GROUPS.flatMap((group) => group.links);

export default function InventoryOverviewPage() {
    const hue = moduleColor("inventory");

    return (
        <div className="space-y-4 p-6">
            <p className="text-muted-foreground text-sm">Choose a master list to create or edit records.</p>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cards.map(({ label, href, icon: Icon }) => (
                    <li key={href}>
                        <Link
                            href={href}
                            className="flex h-full flex-col gap-2 border-2 border-border p-4 transition-shadow hover:shadow-md"
                            // One inventory-green family, fading to the card so the
                            // module wash behind still reads — same treatment the
                            // Accountancy and GST hubs got.
                            style={{ backgroundImage: `linear-gradient(to bottom right, ${moduleTint("inventory", 12, "var(--card)")}, var(--card))` }}
                        >
                            <span className="flex items-center gap-2 font-semibold">
                                <Icon className="size-5 shrink-0" style={{ color: hue }} aria-hidden />
                                {label}
                            </span>
                            {DESCRIPTIONS[href] && (
                                <span className="text-muted-foreground text-sm">{DESCRIPTIONS[href]}</span>
                            )}
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}

"use client";

import { useState } from "react";
import { LayoutGrid, Layers, Tag } from "lucide-react";
import { cn } from "@/shared/lib/format/utils";
import ShopMasterPresentationList from "@/modules/ecommerce/components/ShopMasterPresentationList";

const SUB_TABS = [
    { key: "group", label: "Group", icon: LayoutGrid, apiBase: "/api/inventory/product-groups", imageFolder: "shop/groups", hierarchical: true },
    { key: "category", label: "Collection", icon: Layers, apiBase: "/api/inventory/categories", imageFolder: "shop/categories", hierarchical: true },
    { key: "brand", label: "Brand", icon: Tag, apiBase: "/api/inventory/brands", imageFolder: "shop/brands", hierarchical: false },
] as const;

/**
 * Ecommerce module's own masters page — storefront presentation (slug, image,
 * description) for the three taxonomy masters (Group, Category, Brand). The
 * masters themselves (name, hierarchy, GST/HSN, movement bands) stay owned by
 * `/office/inventory/masters/*`; this page only edits the columns the ecommerce
 * module owns, via the SAME rows and SAME API routes (extended to accept
 * those columns) — one source of truth, two editors for two different
 * audiences (inventory ops vs storefront presentation).
 */
export default function EcommerceMastersPage() {
    const [active, setActive] = useState<(typeof SUB_TABS)[number]["key"]>("group");
    const tab = SUB_TABS.find((t) => t.key === active)!;

    return (
        <div className="flex h-full flex-col gap-4">
            {/* <h2 className="text-xl font-semibold tracking-tight">Shop masters</h2> */}

            <nav className="flex flex-none gap-1 border-b border-border" aria-label="Shop masters">
                {SUB_TABS.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        onClick={() => setActive(t.key)}
                        className={cn(
                            "flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                            active === t.key
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <t.icon className="size-4" aria-hidden />
                        {t.label}
                    </button>
                ))}
            </nav>

            <div className="min-h-0 flex-1">
                <ShopMasterPresentationList
                    key={tab.key}
                    apiBase={tab.apiBase}
                    resourceLabel={tab.label}
                    imageFolder={tab.imageFolder}
                    hierarchical={tab.hierarchical}
                />
            </div>
        </div>
    );
}

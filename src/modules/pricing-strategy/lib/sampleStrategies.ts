// ─────────────────────────────────────────────────────────────────────────────
// Shared sample data for the UI-only strategy prototype. Both the list
// (strategies/page.tsx) and the create/edit page (strategies/create) read from
// here so editing can restore a strategy's real match-conditions. No backend.
// ─────────────────────────────────────────────────────────────────────────────

import {
    emptyMatchConditions,
    type Master,
    type MatchConditionsValue,
} from "@/modules/pricing-strategy/components/MatchConditions";

// Masters — ids are referenced by both the sample products (create page) and the
// sample strategies below, so they must stay in sync.
export const SAMPLE_BRANDS: Master[] = [
    { id: 1, name: "Hikvision" },
    { id: 2, name: "Dahua" },
    { id: 3, name: "TP-Link" },
    { id: 4, name: "Western Digital" },
    { id: 5, name: "Seagate" },
    { id: 6, name: "D-Link" },
    { id: 7, name: "Finolex" },
];

export const SAMPLE_CATEGORIES: Master[] = [
    { id: 1, name: "CCTV" },
    { id: 2, name: "Networking" },
    { id: 3, name: "Storage" },
    { id: 4, name: "Cabling" },
];

export const SAMPLE_GROUPS: Master[] = [
    { id: 1, name: "Cameras" },
    { id: 2, name: "Switches" },
    { id: 3, name: "Hard Drives" },
    { id: 4, name: "Recorders" },
    { id: 5, name: "Cables" },
    { id: 6, name: "Routers" },
];

// Sample products — shared by the create/edit page and the lab. ids reference the
// masters above. costPaise is the only field the lab needs; the rest drive the
// create page's filter preview.
export type SampleProduct = {
    id: number;
    name: string;
    brandId: number;
    categoryId: number;
    groupId: number;
    stock: number;
    costPaise: number;
    pricePaise: number;
    mrpPaise: number;
    /** ISO date of last sale; "" = never sold (infinite age). */
    lastSoldAt: string;
    /** Average units sold per month — sales velocity / movement. */
    monthlyMovement: number;
    attrs: Record<string, unknown>;
};

// Dates relative to "today" 2026-05-31 so staleness ranges demo well.
export const SAMPLE_PRODUCTS: SampleProduct[] = [
    { id: 1, name: "Hikvision 2MP Dome Camera DS-2CE", brandId: 1, categoryId: 1, groupId: 1, stock: 42, costPaise: 89000, pricePaise: 129900, mrpPaise: 149900, lastSoldAt: "2026-05-28", monthlyMovement: 28, attrs: { resolution: 2, type: "Dome", color: "White" } },
    { id: 2, name: "Dahua 4MP Bullet IPC-HFW", brandId: 2, categoryId: 1, groupId: 1, stock: 7, costPaise: 145000, pricePaise: 199900, mrpPaise: 219900, lastSoldAt: "2026-05-12", monthlyMovement: 12, attrs: { resolution: 4, type: "Bullet", color: "White" } },
    { id: 3, name: "TP-Link 8-Port Gigabit Switch", brandId: 3, categoryId: 2, groupId: 2, stock: 0, costPaise: 95000, pricePaise: 134900, mrpPaise: 159900, lastSoldAt: "2026-03-02", monthlyMovement: 4, attrs: { ports: 8, poe: false } },
    { id: 4, name: "WD Purple 2TB Surveillance HDD", brandId: 4, categoryId: 3, groupId: 3, stock: 23, costPaise: 540000, pricePaise: 649900, mrpPaise: 699900, lastSoldAt: "2026-05-30", monthlyMovement: 22, attrs: { capacityTB: 2, color: "Purple" } },
    { id: 5, name: "Hikvision 8-Channel DVR", brandId: 1, categoryId: 1, groupId: 4, stock: 5, costPaise: 380000, pricePaise: 459900, mrpPaise: 499900, lastSoldAt: "2026-04-20", monthlyMovement: 9, attrs: { channels: 8, type: "DVR" } },
    { id: 6, name: "Seagate Skyhawk 4TB HDD", brandId: 5, categoryId: 3, groupId: 3, stock: 0, costPaise: 820000, pricePaise: 949900, mrpPaise: 999900, lastSoldAt: "", monthlyMovement: 0, attrs: { capacityTB: 4, color: "Silver" } },
    { id: 7, name: "D-Link 16-Port PoE Switch", brandId: 6, categoryId: 2, groupId: 2, stock: 11, costPaise: 1250000, pricePaise: 1499900, mrpPaise: 1649900, lastSoldAt: "2026-02-15", monthlyMovement: 3, attrs: { ports: 16, poe: true } },
    { id: 8, name: "Dahua 5MP Dome Camera", brandId: 2, categoryId: 1, groupId: 1, stock: 31, costPaise: 165000, pricePaise: 219900, mrpPaise: 249900, lastSoldAt: "2026-05-29", monthlyMovement: 25, attrs: { resolution: 5, type: "Dome", color: "White" } },
    { id: 9, name: "Cat6 Outdoor Cable 305m Box", brandId: 7, categoryId: 4, groupId: 5, stock: 18, costPaise: 720000, pricePaise: 899900, mrpPaise: 949900, lastSoldAt: "2026-05-05", monthlyMovement: 14, attrs: { lengthM: 305, category: "Cat6" } },
    { id: 10, name: "Hikvision 4K NVR 16-Channel", brandId: 1, categoryId: 1, groupId: 4, stock: 3, costPaise: 980000, pricePaise: 1199900, mrpPaise: 1299900, lastSoldAt: "2026-01-10", monthlyMovement: 2, attrs: { channels: 16, type: "NVR" } },
    { id: 11, name: "TP-Link Wi-Fi 6 Router AX1500", brandId: 3, categoryId: 2, groupId: 6, stock: 26, costPaise: 320000, pricePaise: 399900, mrpPaise: 449900, lastSoldAt: "2026-05-22", monthlyMovement: 20, attrs: { wifi: 6, color: "Black" } },
    { id: 12, name: "WD Purple 6TB Surveillance HDD", brandId: 4, categoryId: 3, groupId: 3, stock: 0, costPaise: 1180000, pricePaise: 1399900, mrpPaise: 1499900, lastSoldAt: "2026-04-01", monthlyMovement: 5, attrs: { capacityTB: 6, color: "Purple" } },
];

/** Reference "today" for the sample data, so idle-days demos are deterministic. */
export const SAMPLE_TODAY = "2026-05-31";

/** Days since a product last sold; Infinity if never sold. */
export function sampleStaleDays(p: SampleProduct): number {
    if (!p.lastSoldAt) return Infinity;
    const sold = new Date(`${p.lastSoldAt}T00:00:00`);
    if (isNaN(sold.getTime())) return Infinity;
    const now = new Date(`${SAMPLE_TODAY}T00:00:00`);
    return Math.floor((now.getTime() - sold.getTime()) / 86_400_000);
}

export type SampleStrategy = {
    id: number;
    name: string;
    marginPct: number;
    active: boolean;
    products: number;
    conditions: MatchConditionsValue;
};

const make = (partial: Partial<MatchConditionsValue>): MatchConditionsValue => ({
    ...emptyMatchConditions(),
    ...partial,
});

export const SAMPLE_STRATEGIES: SampleStrategy[] = [
    { id: 1, name: "All CCTV +25%", marginPct: 25, active: true, products: 6, conditions: make({ categoryIds: new Set([1]) }) },
    { id: 2, name: "Camera clearance", marginPct: 10, active: true, products: 2, conditions: make({ groupIds: new Set([1]), minStaleDays: "60" }) },
    { id: 3, name: "Premium recorders", marginPct: 35, active: true, products: 2, conditions: make({ groupIds: new Set([4]), minCost: "5000" }) },
    { id: 4, name: "Bulk HDD stock", marginPct: 18, active: false, products: 3, conditions: make({ groupIds: new Set([3]), minStock: "10" }) },
    { id: 5, name: "Org-wide fallback", marginPct: 20, active: true, products: 12, conditions: make({}) },
];

export const getSampleStrategy = (id: number): SampleStrategy | undefined =>
    SAMPLE_STRATEGIES.find((s) => s.id === id);

/** Deep-copy a conditions value (fresh Sets + attrs) so editing the form never
 *  mutates the shared sample object. */
export function cloneConditions(c: MatchConditionsValue): MatchConditionsValue {
    return {
        brandIds: new Set(c.brandIds),
        groupIds: new Set(c.groupIds),
        categoryIds: new Set(c.categoryIds),
        attrs: c.attrs.map((a) => ({ ...a })),
        minCost: c.minCost,
        maxCost: c.maxCost,
        minStock: c.minStock,
        maxStock: c.maxStock,
        minStaleDays: c.minStaleDays,
        maxStaleDays: c.maxStaleDays,
    };
}

/** Compact chip labels summarising a strategy's match-conditions (for the list). */
export function conditionChips(
    c: MatchConditionsValue,
    brands: Master[],
    groups: Master[],
    categories: Master[],
): string[] {
    const chips: string[] = [];
    const add = (ids: Set<number>, list: Master[], prefix: string) => {
        if (ids.size === 0) return;
        if (ids.size === 1) {
            const id = [...ids][0];
            chips.push(`${prefix} · ${list.find((m) => m.id === id)?.name ?? `#${id}`}`);
        } else {
            chips.push(`${prefix} · ${ids.size} items`);
        }
    };
    add(c.brandIds, brands, "brand");
    add(c.groupIds, groups, "group");
    add(c.categoryIds, categories, "cat");
    if (c.minCost.trim() || c.maxCost.trim()) chips.push(`cost ₹${c.minCost || "—"}–${c.maxCost || "∞"}`);
    if (c.minStock.trim() || c.maxStock.trim()) chips.push(`stock ${c.minStock || "—"}–${c.maxStock || "∞"}`);
    if (c.minStaleDays.trim() || c.maxStaleDays.trim()) chips.push(`last sale ${c.minStaleDays || "—"}–${c.maxStaleDays || "∞"}d`);
    const attrN = c.attrs.filter((a) => a.key.trim() && a.value.trim()).length;
    if (attrN) chips.push(`attrs · ${attrN}`);
    return chips;
}

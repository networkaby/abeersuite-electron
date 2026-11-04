"use client";

// Plain-words help for the coupon form — what each box means, with shop examples.

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SECTIONS: { title: string; points: string[] }[] = [
    {
        title: "Basics",
        points: [
            "Code — what the customer or staff types. Auto-made; you can change it.",
            "Channel — where it works: POS counter, online shop, or both.",
            "Auto-apply — the bill picks it up by itself when the bill qualifies, no code needed.",
            "Private — not shown in the list of offers; only people you give the code to can use it. Private coupons never auto-apply.",
        ],
    },
    {
        title: "Offer",
        points: [
            "% off — e.g. 20% off, with an optional ₹ cap (max ₹500).",
            "Flat ₹ — fixed rupees off the bill.",
            "Free item — a chosen product free (or at a % off).",
            "Buy X get Y — buy some units, get more of the same free.",
            "Set price — matching items sell at one fixed price.",
        ],
    },
    {
        title: "Item rules",
        points: [
            "Leave empty and the coupon works on the whole bill.",
            "Add product / group / brand / category rules to limit it, e.g. only Samsung phones. Exclude rules keep items out.",
        ],
    },
    {
        title: "Validity & limits",
        points: [
            "Valid from / until — the dates it works.",
            "Min bill ₹ — bill must be at least this much.",
            "Total uses — how many times it can be used by everyone together.",
            "Per-customer uses — how many times one customer can use it.",
            "Eligibility — any customer, new customers only, or returning customers only.",
        ],
    },
    {
        title: "Behaviour — Use with tier + loyalty",
        points: [
            "ON — customer gets the coupon AND their tier discount AND loyalty points. Nothing is taken away.",
            "OFF — the coupon replaces tier discount + points. Then choose where:",
            "• Every item on the bill — e.g. 20% coupon used, so Gold 5% and points are gone for the full bill.",
            "• Only the items this coupon covers — e.g. coupon on Samsung phones: the phone loses Gold 5% + points, the cover and charger on the same bill still get them. Needs item rules; without them it means the whole bill.",
            "Independent (Free item / Buy X get Y only) — the free item comes on top of another coupon on the same bill.",
        ],
    },
    {
        title: "Selling at a loss (stock clearance)",
        points: [
            "At POS, % off / Flat ₹ / Set price stop at each bill's lowest prices. To clear an item below cost, lower its lowest price first, then make a coupon for that item.",
            "Free items (₹0) and Independent part-free coupons can go below the lowest price — the form shows a yellow warning. It is allowed on purpose.",
        ],
    },
    {
        title: "Top bar",
        points: [
            "Coupon max % — no coupon can give more than this % of the bill.",
            "All together max % — coupon + tier + loyalty together cannot cross this % of the bill.",
        ],
    },
];

export function CouponHelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Coupon help</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                    {SECTIONS.map((s) => (
                        <section key={s.title}>
                            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">{s.title}</h3>
                            <ul className="space-y-0.5 text-muted-foreground">
                                {s.points.map((p) => <li key={p}>{p}</li>)}
                            </ul>
                        </section>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}

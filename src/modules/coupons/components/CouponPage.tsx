"use client";

import { useState, type ReactNode } from "react";
import { List, Plus } from "lucide-react";
import { CouponConfigCard } from "./CouponConfigCard";
import { CouponList } from "./CouponList";
import { CouponForm, type RuleMasters } from "./CouponForm";

/// Owns the page-level view: the coupon list ("See coupons") or the full-page
/// editor ("Create coupon"). The Discount guard lives in the header row as a
/// slim input + save, so the create view fits on one screen without scrolling.
export function CouponPage({ masters, brandName }: { masters: RuleMasters; brandName: string }) {
    const [view, setView] = useState<"LIST" | "CREATE">("LIST");

    return (
        <div className="flex h-full min-h-0 w-full flex-col gap-2.5">
            {/* Page header — sits outside the scroll area, so it never scrolls.
                No background of its own: it stays on the page colour. */}
            <div className="flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{view === "CREATE" ? "Create coupon" : "Coupons"}</h1>
                    {/*                    <p className="mt-1 hidden max-w-2xl text-sm text-muted-foreground lg:block"> */}
                    {/* my edit to save space */}
                    {/* {view === "CREATE"
                            ? "Build the offer on one page — everything fits without scrolling."
                            : "Non-stackable coupons replace the spend-tier discount and block loyalty redemption."}
                    </p> */}
                </div>
                <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                    <CouponConfigCard own={{ field: "maxCouponDiscountPct", label: "Coupon max %" }} showLedgers />
                    <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
                        <HeaderTab active={view === "LIST"} onClick={() => setView("LIST")} icon={<List size={14} />}>
                            See coupons
                        </HeaderTab>
                        <HeaderTab active={view === "CREATE"} onClick={() => setView("CREATE")} icon={<Plus size={14} />}>
                            Create coupon
                        </HeaderTab>
                    </div>
                </div>
            </div>

            {view === "CREATE" ? (
                // The card grows to its content; the area below the fixed header
                // scrolls — no scrollbar trapped inside the card itself.
                <div className="min-h-0 flex-1 overflow-auto">
                    <div className="rounded-xl bg-background p-1">
                        <CouponForm
                            fullPage
                            masters={masters}
                            onSaved={() => setView("LIST")}
                            onCancel={() => setView("LIST")}
                        />
                    </div>
                </div>
            ) : (
                <div className="min-h-0 flex-1">
                    <CouponList masters={masters} brandName={brandName} />
                </div>
            )}
        </div>
    );
}

function HeaderTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
                }`}
        >
            {icon}
            {children}
        </button>
    );
}

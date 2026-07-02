"use client";

import Link from "next/link";
import { ShoppingCart, ClipboardList, FileText } from "lucide-react";

/**
 * POS mode switch (Order-to-Cash). POS is mode-first: the cashier chooses a mode
 * before billing, each mode is a SEPARATE page so the protected POS Sale voucher
 * is never touched. The active mode is colour-tinted.
 *
 *  • Sale     — instant, hand-to-hand (the existing POS).            /vouchers/pos/new
 *  • Order    — deferred / deliver-later (Phase 3).                  disabled — "coming soon"
 *  • Estimate — price-privacy quote that captures a CRM Deal.        /vouchers/pos/estimate
 */
export function PosModeSwitch({ active }: { active: "sale" | "order" | "estimate" }) {
    const base =
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors";
    const on = {
        sale: "border-blue-300 bg-blue-100 text-blue-800",
        order: "border-indigo-300 bg-indigo-100 text-indigo-800",
        estimate: "border-amber-300 bg-amber-100 text-amber-800",
    } as const;
    const off = "border-border bg-card text-muted-foreground hover:bg-muted";

    return (
        <div className="flex items-center gap-1.5">
            <Link
                href="/vouchers/pos/new"
                className={`${base} ${active === "sale" ? on.sale : off}`}
                title="Sale — instant counter sale (pay + take now)"
            >
                <ShoppingCart size={14} /> Sale
            </Link>
            <Link
                href="/vouchers/pos/order"
                className={`${base} ${active === "order" ? on.order : off}`}
                title="Order — deliver-later / book-and-collect (no payment, no stock yet)"
            >
                <ClipboardList size={14} /> Order
            </Link>
            <Link
                href="/vouchers/pos/estimate"
                className={`${base} ${active === "estimate" ? on.estimate : off}`}
                title="Estimate — price-privacy quotation; captures a lead"
            >
                <FileText size={14} /> Est
            </Link>
        </div>
    );
}

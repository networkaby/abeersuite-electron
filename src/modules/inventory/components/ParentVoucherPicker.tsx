"use client";
// Combobox-style picker for the parent voucher when raising a derived voucher.
// Examples: a GRN picks its source Purchase Order; a Challan picks its source
// Sales Order; a Rejection In picks the original Sale / Challan; etc.
//
// On pick we hand the caller a hydrated voucher payload (reference + date +
// lines) so the form can copy lines into its own state — see
// `TradingVoucherPage.tsx` wiring under `linkParentType`.

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Loader2, X, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type ParentVoucherLine = {
    id:          number;
    productId:   number;
    description: string | null;
    quantity:    string | number;
    freeQty:     string | number | null;
    rate:        string | number;
    discountPct: string | number;
    discountAmt: string | number;
    taxRate:     string | number;
    taxAmount:   string | number;
    amount:      string | number;
    product: {
        id: number; sku: string; name: string;
        unit: { code: string; label: string };
    };
};

export type ParentVoucherPayload = {
    id:         number;
    reference:  string;
    date:       string;
    partyName:  string | null;
    partyId:    number | null;
    partyType:  string | null;
    partyPhone: string | null;
    lines:      ParentVoucherLine[];
};

type ListRow = {
    id:          number;
    reference:   string;
    date:        string;
    partyName:   string | null;
    totalAmount: string | number;
    _count:      { lines: number };
};

export function ParentVoucherPicker({
    parentType,
    pickedRef,
    onPick,
    onClear,
    label,
}: {
    parentType: string;            // e.g. "PURCHASE_ORDER" | "SALES_ORDER" | "SALE" | "PURCHASE" | "GRN" | "CHALLAN"
    pickedRef: string | null;      // reference of the linked parent, or null
    onPick: (parent: ParentVoucherPayload) => void;
    onClear: () => void;
    label: string;                 // "Link to Purchase Order" / "Link to Sales Order" / …
}) {
    const [query, setQuery] = useState("");
    const [rows, setRows] = useState<ListRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [hydrating, setHydrating] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    // Load candidates (POSTED only — drafts can't be fulfilled against). One
    // fetch on focus, then filtered client-side as the user types — the
    // candidate list per parent type is small enough.
    useEffect(() => {
        if (!open || rows.length || loading) return;
        setLoading(true);
        axios.get<ListRow[]>(`/api/inventory/vouchers?type=${parentType}&status=POSTED`)
            .then((r) => setRows(r.data))
            .catch(() => setRows([]))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, parentType]);

    // Close on outside click.
    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        window.addEventListener("mousedown", onClick);
        return () => window.removeEventListener("mousedown", onClick);
    }, [open]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((r) =>
            r.reference.toLowerCase().includes(q) ||
            (r.partyName ?? "").toLowerCase().includes(q)
        );
    }, [rows, query]);

    const handlePick = async (id: number) => {
        setHydrating(true);
        setOpen(false);
        try {
            const r = await axios.get<ParentVoucherPayload>(`/api/inventory/vouchers/${id}`);
            onPick(r.data);
        } finally {
            setHydrating(false);
        }
    };

    return (
        <div ref={rootRef} className="relative">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1.5">
                <Link2 size={11} /> {label}
            </label>
            {pickedRef ? (
                <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs">
                    <span className="font-mono text-primary truncate">{pickedRef}</span>
                    <button
                        type="button"
                        onClick={onClear}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        title="Unlink parent voucher"
                    >
                        <X size={13} />
                    </button>
                </div>
            ) : (
                <div className="mt-1">
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onFocus={() => setOpen(true)}
                        placeholder={hydrating ? "Loading…" : "Search by reference or party…"}
                        className="h-9 text-xs"
                        disabled={hydrating}
                    />
                    {open && (
                        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                            {loading ? (
                                <div className="flex justify-center py-6">
                                    <Loader2 size={16} className="animate-spin text-muted-foreground" />
                                </div>
                            ) : filtered.length === 0 ? (
                                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                                    No posted {label.replace(/^Link to /i, "")} found.
                                </div>
                            ) : (
                                filtered.map((r) => (
                                    <button
                                        key={r.id}
                                        type="button"
                                        onClick={() => handlePick(r.id)}
                                        className="w-full text-left px-3 py-2 hover:bg-muted border-b last:border-0 border-border/40"
                                    >
                                        <div className="flex items-center justify-between gap-2 text-xs">
                                            <span className="font-mono text-primary">{r.reference}</span>
                                            <span className="text-muted-foreground tabular-nums">
                                                {new Date(r.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-2 mt-0.5 text-xs text-muted-foreground">
                                            <span className="truncate">{r.partyName ?? "—"}</span>
                                            <span className="tabular-nums">{r._count.lines} items</span>
                                        </div>
                                    </button>
                                ))
                            )}
                            <div className="px-3 py-2 border-t border-border/40 text-right">
                                <Button variant="ghost" size="xs" onClick={() => setOpen(false)}>Close</Button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

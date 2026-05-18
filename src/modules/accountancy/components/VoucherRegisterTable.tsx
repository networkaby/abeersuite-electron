"use client";

// Shared voucher row table — the canonical table layout for every register,
// report, and combined view that lists vouchers.  Hosts own data fetching
// + filter chrome (period, kind, status, etc.); this component owns:
//
//   • table head + row markup (date / type / reference link / party / narration / total)
//   • click-to-edit on the Reference cell via referenceHref()
//   • the 3-dot ⋮ action menu per row via DayBookActionsMenu
//   • deleted-row muting + Restore + Hard-Delete in the menu (the menu
//     swaps its items automatically based on row.deletedAt)
//
// Adding a new register page = fetch rows in CombinedRow shape, hand them to
// this table, done.  Behaviour stays uniform — fix once, fixed everywhere.

import React from "react";
import Link from "next/link";
import { fmt } from "@/utils/constants";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { DayBookActionsMenu } from "@/modules/accountancy/components/DayBookActionsMenu";
import { referenceHref } from "@/modules/accountancy/lib/voucherUrls";
import type { CombinedRow } from "@/modules/accountancy/hooks/useCombinedVouchers";

// ── Kind / type badge palette ──────────────────────────────────────────────
// Same palette as the existing Day Book + All Vouchers register.

const KIND_BADGE: Record<string, string> = {
    SALE:            "bg-emerald-100 text-emerald-700",
    POS:             "bg-emerald-200 text-emerald-800",
    PURCHASE:        "bg-blue-100 text-blue-700",
    SALE_RETURN:     "bg-emerald-50 text-emerald-700",
    PURCHASE_RETURN: "bg-blue-50 text-blue-700",
    ESTIMATE:        "bg-amber-100 text-amber-700",
    SALES_ORDER:     "bg-teal-100 text-teal-700",
    PURCHASE_ORDER:  "bg-cyan-100 text-cyan-700",
    GRN:             "bg-cyan-50 text-cyan-700",
    CHALLAN:         "bg-indigo-50 text-indigo-700",
    REJECTION_IN:    "bg-rose-50 text-rose-700",
    REJECTION_OUT:   "bg-rose-100 text-rose-700",
    RECEIPT:         "bg-violet-100 text-violet-700",
    ISSUE:           "bg-orange-50 text-orange-700",
    ADJUSTMENT:      "bg-orange-100 text-orange-700",
    MANUFACTURING_JOURNAL: "bg-yellow-50 text-yellow-700",
    PHYSICAL_STOCK:  "bg-yellow-100 text-yellow-700",
    BRANCH_TRANSFER: "bg-sky-100 text-sky-700",
    PAYMENT:         "bg-red-50 text-red-700",
    CONTRA:          "bg-slate-100 text-slate-700",
    CREDIT_NOTE:     "bg-purple-50 text-purple-700",
    DEBIT_NOTE:      "bg-purple-100 text-purple-700",
    JOURNAL:         "bg-gray-100 text-gray-700",
};

export interface VoucherRegisterRow extends CombinedRow {
    // CombinedRow already has every field we need (rawId, source, kind,
    // reference, date, party, narration, totalAmount, status, deletedAt,
    // cancelledAt, createdBy).  Aliased here so hosts can extend.
}

export interface VoucherRegisterExtraColumn {
    /** Header label rendered in <thead>. */
    header: string;
    /** Cell renderer.  Receives the row; return anything React can render. */
    cell:   (row: VoucherRegisterRow) => React.ReactNode;
    /** Optional column class (alignment, width, etc.). */
    className?: string;
}

export interface VoucherRegisterTableProps {
    rows: VoucherRegisterRow[];
    /** Extra columns injected between Narration and Total. */
    extraColumns?: VoucherRegisterExtraColumn[];
    /** Fired after a row's lifecycle action (cancel / delete / restore / hard-delete) succeeds. */
    onChanged:    () => void;
    /** Hide the Type / Kind column (e.g. for per-kind registers where every row is the same kind). */
    hideKind?:    boolean;
    /** Hide the Source column (default: hidden — only the All Vouchers register turns it on). */
    showSource?:  boolean;
    /** Hide the ⋮ menu (rare — kept as escape hatch). */
    hideActions?: boolean;
    /** Empty-state copy. */
    emptyMessage?: string;
}

// ── Component ──────────────────────────────────────────────────────────────

export function VoucherRegisterTable({
    rows,
    extraColumns,
    onChanged,
    hideKind     = false,
    showSource   = false,
    hideActions  = false,
    emptyMessage = "No vouchers match the current filters.",
}: VoucherRegisterTableProps) {
    if (rows.length === 0) {
        return (
            <div className="rounded-lg border border-border bg-card text-center py-16 text-muted-foreground">
                {emptyMessage}
            </div>
        );
    }

    const colCount =
        1 /* Date */
        + (hideKind ? 0 : 1)
        + (showSource ? 1 : 0)
        + 1 /* Reference */
        + 1 /* Party */
        + 1 /* Narration */
        + (extraColumns?.length ?? 0)
        + 1 /* Total */
        + 1 /* Status */
        + (hideActions ? 0 : 1);

    void colCount; // for future "X of Y rows" footer; kept for symmetry

    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
            <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                    <tr>
                        <th className="px-4 py-3 text-left font-medium">Date</th>
                        {!hideKind  && <th className="px-4 py-3 text-left font-medium">Type</th>}
                        {showSource && <th className="px-4 py-3 text-left font-medium">Source</th>}
                        <th className="px-4 py-3 text-left font-medium">Reference</th>
                        <th className="px-4 py-3 text-left font-medium">Party</th>
                        <th className="px-4 py-3 text-left font-medium">Narration</th>
                        {extraColumns?.map((c) => (
                            <th key={c.header} className={c.className ?? "px-4 py-3 text-left font-medium"}>
                                {c.header}
                            </th>
                        ))}
                        <th className="px-4 py-3 text-right font-medium">Total</th>
                        <th className="px-4 py-3 text-center font-medium">Status</th>
                        {!hideActions && <th className="px-2 py-3" />}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => {
                        const href      = referenceHref(r.source, r.rawId, r.kind);
                        const isDeleted = !!r.deletedAt;
                        return (
                            <tr
                                key={r.id}
                                className={`border-b last:border-0 hover:bg-muted/40 ${
                                    isDeleted ? "opacity-60 italic" : ""
                                }`}
                            >
                                <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                                    {new Date(r.date).toLocaleDateString("en-GB", {
                                        day: "2-digit", month: "short", year: "numeric",
                                    })}
                                </td>
                                {!hideKind && (
                                    <td className="px-4 py-3">
                                        <span className={`text-xs px-2 py-0.5 font-medium rounded-sm ${KIND_BADGE[r.kind] ?? "bg-muted text-muted-foreground"}`}>
                                            {r.kind.replace(/_/g, " ")}
                                        </span>
                                    </td>
                                )}
                                {showSource && (
                                    <td className="px-4 py-3 text-xs text-muted-foreground uppercase">
                                        {r.source}
                                    </td>
                                )}
                                <td className="px-4 py-3 font-mono text-xs">
                                    {href ? (
                                        <Link
                                            href={href}
                                            className="text-primary hover:underline"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {r.reference}
                                        </Link>
                                    ) : (
                                        <span className="text-primary">{r.reference}</span>
                                    )}
                                </td>
                                <td className="px-4 py-3">
                                    {r.party
                                        ? (r.partyKind && r.partyEntityId
                                            ? <Link
                                                  href={`/office/customers/all?${r.partyKind}Id=${r.partyEntityId}`}
                                                  className="text-primary hover:underline"
                                                  onClick={(e) => e.stopPropagation()}
                                              >
                                                  {r.party}
                                              </Link>
                                            : r.party)
                                        : <span className="text-muted-foreground/50">—</span>}
                                </td>
                                <td className="px-4 py-3 text-muted-foreground max-w-[260px] truncate">
                                    {r.narration ?? "—"}
                                </td>
                                {extraColumns?.map((c) => (
                                    <td key={c.header} className={c.className ?? "px-4 py-3"}>
                                        {c.cell(r)}
                                    </td>
                                ))}
                                <td className="px-4 py-3 text-right font-mono">
                                    ₹ {fmt(r.totalAmount)}
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <StatusBadge kind="journal" value={isDeleted ? "DELETED" : r.status} />
                                </td>
                                {!hideActions && (
                                    <td
                                        className="px-2 py-3 text-right"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <DayBookActionsMenu
                                            rawId={r.rawId}
                                            source={r.source}
                                            kind={r.kind}
                                            reference={r.reference}
                                            deletedAt={r.deletedAt}
                                            onChanged={onChanged}
                                        />
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

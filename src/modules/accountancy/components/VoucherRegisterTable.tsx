"use client";

// Shared voucher row table — the canonical table layout for every register,
// report, and combined view that lists vouchers.  This component owns:
//
//   • table head + row markup (date / type / reference link / party / narration / total)
//   • click-to-edit on the Reference cell via referenceHref()
//   • the 3-dot ⋮ action menu per row via DayBookActionsMenu
//   • deleted-row muting + Restore + Hard-Delete in the menu
//   • row-click expand — fetches Dr/Cr or inventory lines on demand
//   • optional props for Day-Book-style layout:
//       stickyHead    — sticky thead for full-page scroll layouts
//       statusInline  — status pill inside Type cell, hides Status column
//       optionalKinds — bg-muted/10 + italic for documentary voucher rows
//       accentBySource — coloured left stripe per row (inv=blue, gl=violet, je=amber)
//       showSettlement — "Bill-wise" column: Settled / Partial / Due, click to match
//
// Adding a new register page = fetch rows in CombinedRow shape, hand them to
// this table, done.  Behaviour stays uniform — fix once, fixed everywhere.

import React, { useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { fmt, JOURNAL_STATUS_COLORS } from "@/utils/constants";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { DayBookActionsMenu } from "@/modules/accountancy/components/DayBookActionsMenu";
import { referenceHref } from "@/modules/accountancy/lib/voucherUrls";
import { SettlementChip } from "@/modules/accountancy/components/SettlementChip";
import { BillLinkDialog, clearBillLinkCache } from "@/modules/accountancy/components/BillLinkDialog";
import { clearPartyCache } from "@/modules/accountancy/components/PartyOutstandingsPanel";
import type { CombinedRow } from "@/modules/accountancy/hooks/useDayBook";
import { moduleTableHeadStyle } from "@/shared/lib/format/moduleTheme";

// ── Line shapes ───────────────────────────────────────────────────────────

type GlLine = {
    account: { id?: number; code: string; name: string };
    type: "DEBIT" | "CREDIT";
    amount: number;
};
type InvLine = {
    product: { id: number; sku: string; name: string; unit?: { code: string; label: string } | null };
    quantity: number;
    rate: number;
    amount: number;
};
type Line = GlLine | InvLine;

// ── Source accent colours (used when accentBySource is true) ──────────────

const SOURCE_ACCENT: Record<CombinedRow["source"], string> = {
    inv: "bg-blue-400",
    gl:  "bg-violet-400",
    je:  "bg-amber-400",
};

// ── Kind badge palette ────────────────────────────────────────────────────

const KIND_BADGE: Record<string, string> = {
    SALE:                  "bg-emerald-100 text-emerald-700",
    POS:                   "bg-emerald-200 text-emerald-800",
    ONLINE_INVOICE:        "bg-green-100 text-green-700",
    PURCHASE:              "bg-blue-100 text-blue-700",
    SALE_RETURN:           "bg-emerald-50 text-emerald-700",
    PURCHASE_RETURN:       "bg-blue-50 text-blue-700",
    ESTIMATE:              "bg-amber-100 text-amber-700",
    POS_ESTIMATE:          "bg-amber-200 text-amber-800",
    POS_ORDER:             "bg-indigo-100 text-indigo-700",
    ONLINE_ORDER:          "bg-violet-100 text-violet-700",
    SALES_ORDER:           "bg-teal-100 text-teal-700",
    PURCHASE_ORDER:        "bg-cyan-100 text-cyan-700",
    GRN:                   "bg-cyan-50 text-cyan-700",
    CHALLAN:               "bg-indigo-50 text-indigo-700",
    REJECTION_IN:          "bg-rose-50 text-rose-700",
    REJECTION_OUT:         "bg-rose-100 text-rose-700",
    MANUFACTURING_JOURNAL: "bg-yellow-50 text-yellow-700",
    PHYSICAL_STOCK:        "bg-yellow-100 text-yellow-700",
    BRANCH_TRANSFER:       "bg-sky-100 text-sky-700",
    PAYMENT:               "bg-red-50 text-red-700",
    CONTRA:                "bg-slate-100 text-slate-700",
    CREDIT_NOTE:           "bg-purple-50 text-purple-700",
    DEBIT_NOTE:            "bg-purple-100 text-purple-700",
    JOURNAL:               "bg-gray-100 text-gray-700",
};

// ── Types ─────────────────────────────────────────────────────────────────

export type VoucherRegisterRow = CombinedRow;

export interface VoucherRegisterExtraColumn {
    header:     string;
    cell:       (row: VoucherRegisterRow) => React.ReactNode;
    className?: string;
}

export interface VoucherRegisterTableProps {
    rows:           VoucherRegisterRow[];
    /** Extra columns injected between Narration and Total. */
    extraColumns?:  VoucherRegisterExtraColumn[];
    /** Fired after a row lifecycle action succeeds. */
    onChanged:      () => void;
    /** Hide the Type/Kind column (per-kind registers). */
    hideKind?:      boolean;
    /** Show the Source column (only the All Vouchers register needs this). */
    showSource?:    boolean;
    /** Hide the ⋮ actions menu. */
    hideActions?:   boolean;
    /** Sticky thead for full-page scroll layouts (Day Book). */
    stickyHead?:    boolean;
    /** Status pill inside the Type cell; hides the separate Status column. */
    statusInline?:  boolean;
    /** Rows whose kind is in this set get bg-muted/10 + italic (optional/documentary vouchers). */
    optionalKinds?: Set<string>;
    /** Thin coloured left stripe per row keyed by source (inv=blue, gl=violet, je=amber). */
    accentBySource?: boolean;
    /** Show a Branch column (after Reference). inv rows show their branch name; gl/je show —. */
    showBranch?: boolean;
    /** Show the "Bill-wise" column — whether each voucher has been matched off
     *  against the other side, bill by bill, and a click into the popup that
     *  does the matching. A different axis from the lifecycle Status column:
     *  Posted says what the voucher IS, Settled says what its money was
     *  pointed AT. */
    showSettlement?: boolean;
    /** Empty-state copy. */
    emptyMessage?:  string;
}

// ── Component ─────────────────────────────────────────────────────────────

export function VoucherRegisterTable({
    rows,
    extraColumns,
    onChanged,
    hideKind       = false,
    showSource     = false,
    hideActions    = false,
    stickyHead     = false,
    statusInline   = false,
    optionalKinds,
    accentBySource = false,
    showBranch     = false,
    showSettlement = false,
    emptyMessage   = "No vouchers match the current filters.",
}: VoucherRegisterTableProps) {
    // Hooks before any early return.
    // Which voucher's bill-wise popup is open, and on whose ledger it is measured.
    const [linkRow, setLinkRow] = useState<{ uvId: number; accountId: number; party: string | null } | null>(null);
    const [expanded,  setExpanded]  = useState<Set<string>>(new Set());
    const [lineCache, setLineCache] = useState<Map<string, Line[] | "loading" | "error">>(new Map());

    const fetchLines = (r: VoucherRegisterRow) => {
        if (lineCache.has(r.id)) return;
        setLineCache((c) => new Map(c).set(r.id, "loading"));
        const url =
            r.source === "inv" ? `/api/inventory/vouchers/${r.rawId}` :
            r.source === "gl"  ? `/api/accountancy/vouchers/${r.rawId}` :
                                  `/api/accountancy/journal-entries/${r.rawId}`;
        axios.get<{ lines: Line[] }>(url)
            .then((res) => setLineCache((c) => new Map(c).set(r.id, res.data.lines ?? [])))
            .catch(() => setLineCache((c) => new Map(c).set(r.id, "error")));
    };

    const toggleExpand = (r: VoucherRegisterRow) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(r.id)) { next.delete(r.id); }
            else { next.add(r.id); fetchLines(r); }
            return next;
        });
    };

    if (rows.length === 0) {
        return (
            <div className="rounded-lg border border-border bg-card text-center py-16 text-muted-foreground">
                {emptyMessage}
            </div>
        );
    }

    const colCount =
        (accentBySource ? 1 : 0) /* accent stripe */
        + 1 /* Date */
        + (hideKind ? 0 : 1)
        + (showSource ? 1 : 0)
        + 1 /* Reference */
        + (showBranch ? 1 : 0)
        + 1 /* Party */
        + 1 /* Narration */
        + (extraColumns?.length ?? 0)
        + 1 /* Total */
        + (showSettlement ? 1 : 0) /* Bill-wise */
        + (statusInline ? 0 : 1) /* Status column — absent when inline */
        + (hideActions ? 0 : 1);

    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
            <table className="w-full text-sm">
                {/* Tinted head only. Every row below keeps its own colours —
                    accentBySource says which register a row came from, and that
                    is data meaning, not decoration. The tint is opaque because a
                    sticky head scrolls its own rows underneath itself. */}
                <thead
                    className={[
                        "border-b border-border text-xs text-muted-foreground",
                        stickyHead ? "sticky top-0 z-10" : "",
                    ].join(" ")}
                    style={moduleTableHeadStyle("accountancy")}
                >
                    <tr>
                        {accentBySource && <th className="w-1 p-0" />}
                        <th className="px-3 py-3 text-left font-medium">Date</th>
                        {!hideKind   && <th className="px-3 py-3 text-left font-medium">Type</th>}
                        {showSource  && <th className="px-3 py-3 text-left font-medium">Source</th>}
                        <th className="px-3 py-3 text-left font-medium">Voucher No</th>
                        {showBranch  && <th className="px-3 py-3 text-left font-medium">Branch</th>}
                        <th className="px-3 py-3 text-left font-medium">Party</th>
                        <th className="px-3 py-3 text-left font-medium">Narration</th>
                        {extraColumns?.map((c) => (
                            <th key={c.header} className={c.className ?? "px-3 py-3 text-left font-medium"}>
                                {c.header}
                            </th>
                        ))}
                        <th className="px-3 py-3 text-right font-medium">Total</th>
                        {showSettlement && <th className="px-3 py-3 text-center font-medium">Bill-wise</th>}
                        {!statusInline && <th className="px-3 py-3 text-center font-medium">Status</th>}
                        {!hideActions  && <th className="w-10 p-0" />}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => {
                        const href        = referenceHref(r.source, r.rawId, r.kind);
                        const isOpt       = optionalKinds?.has(r.kind) ?? false;
                        const isDraft     = r.status === "DRAFT";
                        const isCancelled = r.status === "CANCELLED";
                        const isPosted    = r.status === "POSTED";
                        const isExpanded  = expanded.has(r.id);
                        const lines       = lineCache.get(r.id);
                        const accent      = SOURCE_ACCENT[r.source];

                        return (
                            <React.Fragment key={r.id}>
                                {/* ── Main row ───────────────────────── */}
                                <tr
                                    className={[
                                        "border-b last:border-0 hover:bg-muted/40 transition-opacity cursor-pointer",
                                        isDraft     ? "opacity-50"  : "",
                                        isCancelled ? "opacity-30"  : "",
                                        isOpt       ? "bg-muted/10" : "",
                                    ].filter(Boolean).join(" ")}
                                    title="Click to expand lines · Click reference to edit"
                                    onClick={() => toggleExpand(r)}
                                >
                                    {/* Accent stripe */}
                                    {accentBySource && <td className={`w-1 p-0 ${accent}`} />}

                                    {/* Date */}
                                    <td className="px-3 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
                                        {new Date(r.date).toLocaleDateString("en-GB", {
                                            day: "2-digit", month: "short", year: "2-digit",
                                        })}
                                    </td>

                                    {/* Type — with optional status pill when statusInline */}
                                    {!hideKind && (
                                        <td className="px-3 py-2.5">
                                            <div className="flex items-center gap-1.5">
                                                <span className={[
                                                    "text-xs px-2 py-0.5 font-medium rounded-sm",
                                                    KIND_BADGE[r.kind] ?? "bg-muted text-muted-foreground",
                                                    isOpt ? "ring-1 opacity-80" : "",
                                                ].join(" ")}>
                                                    <span className={isOpt ? "italic" : ""}>
                                                        {r.kind.replace(/_/g, " ")}
                                                    </span>
                                                </span>
                                                {statusInline && !isPosted && r.status && (
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${JOURNAL_STATUS_COLORS[r.status] ?? "bg-muted text-muted-foreground"}`}>
                                                        {r.status.toLowerCase()}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                    )}

                                    {/* Source */}
                                    {showSource && (
                                        <td className="px-3 py-2.5 text-xs text-muted-foreground uppercase">
                                            {r.source}
                                        </td>
                                    )}

                                    {/* Reference — bold when posted, strikethrough when cancelled (statusInline) */}
                                    <td
                                        className={[
                                            "px-3 py-2.5 font-mono text-xs",
                                            statusInline && isPosted    ? "text-foreground font-semibold" : "text-primary",
                                            statusInline && isCancelled ? "line-through text-muted-foreground" : "",
                                        ].filter(Boolean).join(" ")}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {href ? (
                                            <Link href={href} className="hover:underline underline-offset-2">
                                                {r.reference}
                                            </Link>
                                        ) : (
                                            <span>{r.reference}</span>
                                        )}
                                        {r.converted && (
                                            <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium not-italic text-emerald-700">
                                                Converted
                                            </span>
                                        )}
                                    </td>

                                    {/* Branch — inv rows only; gl/je show — */}
                                    {showBranch && (
                                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                                            {r.branchName ?? "—"}
                                        </td>
                                    )}

                                    {/* Party — italic when optional */}
                                    <td
                                        className={`px-3 py-2.5 text-sm ${isOpt ? "italic text-muted-foreground" : ""}`}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {r.party
                                            ? (r.partyKind && r.partyEntityId
                                                ? <Link
                                                      href={`/office/customers/all?${r.partyKind}Id=${r.partyEntityId}`}
                                                      className="text-primary hover:underline underline-offset-2"
                                                  >
                                                      {r.party}
                                                  </Link>
                                                : r.party)
                                            : <span className="text-muted-foreground/65">—</span>}
                                    </td>

                                    {/* Narration — italic when optional */}
                                    <td className={[
                                        "px-3 py-2.5 text-xs max-w-[200px] truncate",
                                        isOpt ? "italic text-muted-foreground" : "text-muted-foreground",
                                    ].join(" ")}>
                                        {r.narration ?? "—"}
                                    </td>

                                    {/* Extra columns */}
                                    {extraColumns?.map((c) => (
                                        <td key={c.header} className={c.className ?? "px-3 py-2.5"}>
                                            {c.cell(r)}
                                        </td>
                                    ))}

                                    {/* Total — bold when posted (statusInline) */}
                                    <td className={[
                                        "px-3 py-2.5 text-right font-mono text-sm",
                                        statusInline && isPosted ? "font-semibold text-foreground" : "text-muted-foreground",
                                    ].filter(Boolean).join(" ")}>
                                        ₹ {fmt(r.totalAmount)}
                                    </td>

                                    {/* Bill-wise — a different axis from Status. Only a
                                        voucher that actually put something on a party's
                                        account can be matched off, so a bill taken in
                                        full at the counter shows the word without the
                                        click. */}
                                    {showSettlement && (
                                        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                                            <SettlementChip
                                                state={r.settlement}
                                                open={r.settlementOpen}
                                                onLink={r.settlement && r.settlement !== "SETTLED"
                                                    && r.universalVoucherId != null && r.partyAccountId != null
                                                    ? () => setLinkRow({
                                                        uvId:      r.universalVoucherId!,
                                                        accountId: r.partyAccountId!,
                                                        party:     r.party,
                                                    })
                                                    : undefined}
                                            />
                                        </td>
                                    )}

                                    {/* Status column — hidden when statusInline */}
                                    {!statusInline && (
                                        <td className="px-3 py-2.5 text-center">
                                            <StatusBadge kind="journal" value={r.status} />
                                        </td>
                                    )}

                                    {/* Actions */}
                                    {!hideActions && (
                                        <td
                                            className="px-2 py-2.5 text-right"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <DayBookActionsMenu
                                                rawId={r.rawId}
                                                source={r.source}
                                                kind={r.kind}
                                                reference={r.reference}
                                                converted={r.converted}
                                                onChanged={onChanged}
                                            />
                                        </td>
                                    )}
                                </tr>

                                {/* ── Expand: loading ────────────────── */}
                                {isExpanded && lines === "loading" && (
                                    <tr className="bg-muted/20 border-b last:border-0">
                                        <td colSpan={colCount} className="px-6 py-2 text-xs text-muted-foreground">
                                            <Loader2 className="animate-spin size-3 inline mr-1.5" />
                                            Loading lines…
                                        </td>
                                    </tr>
                                )}

                                {/* ── Expand: error ──────────────────── */}
                                {isExpanded && lines === "error" && (
                                    <tr className="bg-muted/20 border-b last:border-0">
                                        <td colSpan={colCount} className="px-6 py-2 text-xs text-destructive">
                                            Failed to load lines.
                                        </td>
                                    </tr>
                                )}

                                {/* ── Expand: empty ──────────────────── */}
                                {isExpanded && Array.isArray(lines) && lines.length === 0 && (
                                    <tr className="bg-muted/20 border-b last:border-0">
                                        <td colSpan={colCount} className="px-6 py-2 text-xs text-muted-foreground">
                                            No lines found.
                                        </td>
                                    </tr>
                                )}

                                {/* ── Expand: line rows ──────────────── */}
                                {isExpanded && Array.isArray(lines) && lines.map((l, i) => {
                                    const isGl = "account" in l;
                                    return (
                                        <tr key={`${r.id}-line-${i}`} className="bg-muted/20 border-b last:border-0">
                                            {/* Accent stripe — faded */}
                                            {accentBySource && <td className={`w-1 p-0 ${accent} opacity-30`} />}
                                            {/* Date — blank */}
                                            <td />
                                            {/* Type — Dr/Cr or item badge */}
                                            {!hideKind && (
                                                <td className="px-3 py-1">
                                                    {isGl ? (
                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                                                            l.type === "DEBIT" ? "bg-blue-50 text-blue-600" : "bg-violet-50 text-violet-600"
                                                        }`}>
                                                            {l.type === "DEBIT" ? "Dr" : "Cr"}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-muted text-muted-foreground">
                                                            item
                                                        </span>
                                                    )}
                                                </td>
                                            )}
                                            {/* Source — blank placeholder */}
                                            {showSource && <td />}
                                            {/* Reference — account code or SKU */}
                                            <td className="px-3 py-1 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                                                {isGl ? l.account.code : l.product.sku}
                                            </td>
                                            {/* Branch placeholder */}
                                            {showBranch && <td />}
                                            {/* Party + Narration */}
                                            {isGl ? (
                                                <td colSpan={2} className="px-3 py-1 text-xs text-foreground">
                                                    {l.account.name}
                                                </td>
                                            ) : (
                                                <>
                                                    <td className="px-3 py-1 text-xs text-foreground">{l.product.name}</td>
                                                    <td className="px-3 py-1 text-xs text-muted-foreground font-mono">
                                                        {l.quantity} × ₹{fmt(Number(l.rate))}
                                                    </td>
                                                </>
                                            )}
                                            {/* Extra columns — blank placeholders */}
                                            {extraColumns?.map((c) => <td key={c.header} />)}
                                            {/* Amount */}
                                            <td className="px-3 py-1 text-right font-mono text-xs tabular-nums text-muted-foreground">
                                                ₹ {fmt(Number(l.amount))}
                                            </td>
                                            {/* Bill-wise placeholder — only when column exists */}
                                            {showSettlement && <td />}
                                            {/* Status placeholder — only when column exists */}
                                            {!statusInline && <td />}
                                            {/* Actions — blank */}
                                            {!hideActions && <td />}
                                        </tr>
                                    );
                                })}
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>

            {/* The same bill-wise popup the party's Transactions tab and the
                receipt form open — tick list, Auto, part amounts and all. The
                table hosts it rather than the chip, so one popup serves every
                row instead of fifty mounted dialogs. */}
            {linkRow && (
                <BillLinkDialog
                    open
                    onOpenChange={(v) => { if (!v) setLinkRow(null); }}
                    accountId={linkRow.accountId}
                    partyName={linkRow.party ?? undefined}
                    voucherId={linkRow.uvId}
                    // A link writes no GL and does not touch the voucher's own
                    // row, so a Day Book delta would never notice it. The reload
                    // is what brings the chip down to Settled.
                    onSaved={() => {
                        clearBillLinkCache();
                        clearPartyCache(linkRow.accountId);
                        setLinkRow(null);
                        onChanged();
                    }}
                />
            )}
        </div>
    );
}

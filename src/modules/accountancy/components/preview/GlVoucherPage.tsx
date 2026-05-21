"use client";

// PREVIEW MIGRATION — Tally-finish full-page voucher form for the five
// pure-GL voucher kinds (Payment, Receipt, Contra, Credit Note, Debit Note).
// Mirrors the data model + per-kind COPY config of `GlVoucherDialog.tsx`
// but lays out as a Tally classic voucher: compact top strip, two-column
// Particulars / Amount body, balance indicator + amount-in-words, sticky
// footer. Create-only (matches the existing dialogs' scope).

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Plus, Trash2, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogDescription,
    DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fmt, JOURNAL_STATUS_COLORS } from "@/utils/constants";
import { parseAmount, isAmountChars } from "@/utils/numberInput";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { consumeDuplicate } from "@/modules/accountancy/lib/duplicate";
import { GlAccountCombobox, type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { BalanceHint } from "@/modules/accountancy/components/BalanceHint";
import { LifecycleActions } from "@/modules/accountancy/components/LifecycleActions";
import { VoucherTopBar } from "@/modules/accountancy/components/VoucherTopBar";
import { VoucherActionBar } from "@/modules/accountancy/components/VoucherActionBar";
import {
    PartySearchAndCreate,
    type PartySearchAndCreateHandle,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import { numberToIndianWords } from "@/shared/lib/format/numberWords";

// ── Loaded voucher shape (used in edit mode) ────────────────────────────────

type LoadedLine = {
    accountId:   number;
    type:        "DEBIT" | "CREDIT";
    amount:      number | string;
    description: string | null;
};

type LoadedVoucher = {
    id:             number;
    reference:      string;
    date:           string;
    narration:      string | null;
    status:         "DRAFT" | "POSTED" | "CANCELLED";
    cancelledAt:    string | null;
    deletedAt:      string | null;
    partyAccountId: number | null;
    partyAccount:   { id: number; code: string | null; name: string } | null;
    lines:          LoadedLine[];
};

// Normalized line for dirty-check comparison.
type SnapLine = { accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description: string };
type Snapshot = { date: string; narration: string; lines: SnapLine[] };

function normalizeLines(lines: { accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description?: string | null }[]): SnapLine[] {
    return lines
        .map((l) => ({
            accountId:   l.accountId,
            type:        l.type,
            amount:      Math.round(l.amount * 100) / 100,
            description: (l.description ?? "").trim(),
        }))
        .sort((a, b) =>
            a.accountId - b.accountId
            || a.type.localeCompare(b.type)
            || a.amount - b.amount,
        );
}

function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
    if (a.date !== b.date) return false;
    if (a.narration !== b.narration) return false;
    if (a.lines.length !== b.lines.length) return false;
    for (let i = 0; i < a.lines.length; i++) {
        const x = a.lines[i], y = b.lines[i];
        if (x.accountId !== y.accountId) return false;
        if (x.type !== y.type) return false;
        if (Math.abs(x.amount - y.amount) > 0.005) return false;
        if (x.description !== y.description) return false;
    }
    return true;
}

// ── Kind + COPY config ──────────────────────────────────────────────────────
// CONTRA folds into the same Kind union as a 5th voucher — same data shape
// (top side + multi particulars rows), only filters and Dr/Cr signs differ.

export type MoneyFlowKind = "PAYMENT" | "RECEIPT" | "CONTRA" | "CREDIT_NOTE" | "DEBIT_NOTE";

const CASH_BANK_GROUPS = [ACCOUNT_GROUPS.CASH_IN_HAND, ACCOUNT_GROUPS.BANK_ACCOUNTS] as const;
const isCashOrBank      = (a: GlAccount) => CASH_BANK_GROUPS.includes(a.group?.name as typeof CASH_BANK_GROUPS[number]);
const isSundryDebtor    = (a: GlAccount) => a.group?.name === ACCOUNT_GROUPS.SUNDRY_DEBTORS;
const isSundryCreditor  = (a: GlAccount) => a.group?.name === ACCOUNT_GROUPS.SUNDRY_CREDITORS;

type Side = "DEBIT" | "CREDIT";

type KindConfig = {
    title:                string;
    topLabel:             string;   // "Paid from" / "Received in" / "From" / customer label / supplier label
    rowsHeader:           string;   // "Paid to" / "Received from" / "To" / "Against"
    topPlaceholder:       string;
    rowPlaceholder:       string;
    narrationPlaceholder: string;
    topSide:              Side;     // accounting side of the top line
    rowSide:              Side;     // accounting side of each particulars row
    topPickerKind:        "ledger" | "party";
    /// When topPickerKind === "ledger", filters the GL combobox.
    topFilter:            (a: GlAccount) => boolean;
    /// Always applied to the particulars combobox.
    rowFilter:            (a: GlAccount) => boolean;
    /// Account group for the party picker (Credit/Debit Note only).
    partyGroup?:          typeof ACCOUNT_GROUPS.SUNDRY_DEBTORS | typeof ACCOUNT_GROUPS.SUNDRY_CREDITORS;
    listPath:             string;
};

const PER_KIND: Record<MoneyFlowKind, KindConfig> = {
    PAYMENT: {
        title:                "Payment Voucher",
        topLabel:             "Paid from",
        rowsHeader:           "Paid to",
        topPlaceholder:       "Cash-in-Hand / Bank Account…",
        rowPlaceholder:       "Party / expense / income…",
        narrationPlaceholder: "e.g. Office rent for May 2026",
        topSide:              "CREDIT",
        rowSide:              "DEBIT",
        topPickerKind:        "ledger",
        topFilter:            isCashOrBank,
        rowFilter:            () => true,
        listPath:             "/office/accountancy/vouchers-registers/payments",
    },
    RECEIPT: {
        title:                "Receipt Voucher",
        topLabel:             "Received in",
        rowsHeader:           "Received from",
        topPlaceholder:       "Cash-in-Hand / Bank Account…",
        rowPlaceholder:       "Party / income / refund…",
        narrationPlaceholder: "e.g. Cash received from Acme Corp",
        topSide:              "DEBIT",
        rowSide:              "CREDIT",
        topPickerKind:        "ledger",
        topFilter:            isCashOrBank,
        rowFilter:            () => true,
        listPath:             "/office/accountancy/vouchers-registers/receipts",
    },
    CONTRA: {
        title:                "Contra Voucher",
        topLabel:             "From",
        rowsHeader:           "To",
        topPlaceholder:       "Cash-in-Hand / Bank Account…",
        rowPlaceholder:       "Cash-in-Hand / Bank Account…",
        narrationPlaceholder: "e.g. Deposit cash to HDFC current account",
        topSide:              "CREDIT",
        rowSide:              "DEBIT",
        topPickerKind:        "ledger",
        topFilter:            isCashOrBank,
        rowFilter:            isCashOrBank,
        listPath:             "/office/accountancy/vouchers-registers/contras",
    },
    CREDIT_NOTE: {
        title:                "Credit Note",
        topLabel:             "Customer",
        rowsHeader:           "Against",
        topPlaceholder:       "Search customer by name or phone…",
        rowPlaceholder:       "Sales Returns / Discount Allowed / …",
        narrationPlaceholder: "e.g. Sales return — damaged in transit",
        topSide:              "CREDIT",
        rowSide:              "DEBIT",
        topPickerKind:        "party",
        topFilter:            isSundryDebtor,
        rowFilter:            () => true,
        partyGroup:           ACCOUNT_GROUPS.SUNDRY_DEBTORS,
        listPath:             "/office/accountancy/vouchers-registers/credit-notes",
    },
    DEBIT_NOTE: {
        title:                "Debit Note",
        topLabel:             "Supplier",
        rowsHeader:           "Against",
        topPlaceholder:       "Search supplier by name or phone…",
        rowPlaceholder:       "Purchase Returns / Discount Received / …",
        narrationPlaceholder: "e.g. Purchase return — wrong model to Acme",
        topSide:              "DEBIT",
        rowSide:              "CREDIT",
        topPickerKind:        "party",
        topFilter:            isSundryCreditor,
        rowFilter:            () => true,
        partyGroup:           ACCOUNT_GROUPS.SUNDRY_CREDITORS,
        listPath:             "/office/accountancy/vouchers-registers/debit-notes",
    },
};

// ── Row model ───────────────────────────────────────────────────────────────

type Row = {
    id:        number;
    accountId: number | null;
    amount:    string;
    note:      string;
};

let rowSeq = 0;
const newRow = (): Row => ({ id: ++rowSeq, accountId: null, amount: "", note: "" });

// ── Component ───────────────────────────────────────────────────────────────

export function GlVoucherPage({ kind, voucherId }: { kind: MoneyFlowKind; voucherId?: number }) {
    const router = useRouter();
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canCancel     = hasPermissionWithScope(permissions, "finance:voucher:cancel");
    const canDelete     = hasPermissionWithScope(permissions, "finance:voucher:delete");
    const canHardDelete = hasPermissionWithScope(permissions, "finance:voucher:hard-delete");

    const copy = PER_KIND[kind];
    const isEditing = voucherId != null && Number.isFinite(voucherId);

    // Close / Cancel / Back — go back if there's tab history, otherwise fall
    // Close / back behaviour:
    //   • Same-tab navigation (e.g. Day Book → form): router.back() returns
    //     to the caller without disturbing any other view.
    //   • New-tab open (ButtonBar uses window.open("…", "_blank")):
    //     history.length === 1, so router.back() is a silent no-op.
    //     window.close() closes the script-opened tab in Chrome/Firefox.
    //   • Manually-typed URL (history.length === 1, no opener):
    //     window.close() also silently fails — acceptable, user can Ctrl+W.
    //   We deliberately do NOT fall back to router.push(listPath) so we
    //   never hijack the user's attention by opening the register.
    const closeForm = () => {
        if (typeof window === "undefined") return;
        if (window.history.length > 1) {
            router.back();
        } else {
            window.close();
        }
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (document.querySelector('[data-state="open"][role="dialog"]')) return;
            if (isDirtyRef.current) { setCloseDialogOpen(true); return; }
            if (typeof window !== "undefined") {
                if (window.history.length > 1) router.back(); else window.close();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [router]);
    const isDirtyRef = useRef(false);
    const [closeDialogOpen, setCloseDialogOpen] = useState(false);
    const handleClose = () => {
        if (isDirtyRef.current) { setCloseDialogOpen(true); } else { closeForm(); }
    };

    // Accounts loaded once on mount; particulars combobox picks from rowFilter,
    // top picker from topFilter.
    const [accounts, setAccounts] = useState<GlAccount[]>([]);
    const [nextRef, setNextRef] = useState<string>("");
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(isEditing);
    const [loadedVoucher, setLoadedVoucher] = useState<LoadedVoucher | null>(null);
    // Bumped after any lifecycle action so the prefill effect re-runs.
    const [reloadCounter, setReloadCounter] = useState(0);
    const originalSnapshotRef = useRef<Snapshot | null>(null);
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [narration, setNarration] = useState("");

    // Top side — either a Cash/Bank ledger (Payment/Receipt/Contra) or a Party
    // ledger picked via the shared customer-supplier picker (CN/DN).
    const [topLedgerId, setTopLedgerId] = useState<number | null>(null);
    const [topParty, setTopParty] = useState<PickedParty | null>(null);
    const partyPickerRef = useRef<PartySearchAndCreateHandle>(null);
    // In edit mode we always read from topLedgerId so the prefilled party
    // account flows through without us needing a fully-built PickedParty.
    const effectiveTopAccountId: number | null = isEditing
        ? topLedgerId
        : copy.topPickerKind === "party" ? (topParty?.accountId ?? null) : topLedgerId;

    const [rows, setRows] = useState<Row[]>([newRow()]);

    const accountById = new Map<number, GlAccount>(accounts.map((a) => [a.id, a]));
    const topAccounts = accounts.filter(copy.topFilter);
    const rowAccounts = accounts.filter(copy.rowFilter);
    const topAccount  = effectiveTopAccountId ? accountById.get(effectiveTopAccountId) : undefined;

    const rowsTotal = rows.reduce((s, r) => s + parseAmount(r.amount), 0);
    const topTotal  = rowsTotal;  // top side auto-derives from particulars sum
    const balanced  = rowsTotal > 0
        && rows.every((r) => r.accountId !== null && parseAmount(r.amount) > 0)
        && !!effectiveTopAccountId
        // top account can't equal any particulars account (would self-balance)
        && rows.every((r) => r.accountId !== effectiveTopAccountId);

    useEffect(() => {
        axios.get<GlAccount[]>("/api/accountancy/gl-accounts?includeParties=true")
            .then((r) => setAccounts(r.data))
            .catch(() => toast.error("Failed to load accounts"));
        // Skip the next-ref fetch in edit mode — we'll show the loaded reference.
        if (!isEditing) {
            axios.get<{ reference: string }>(`/api/accountancy/vouchers/next-ref?type=${kind}`)
                .then((r) => setNextRef(r.data.reference))
                .catch(() => setNextRef(""));
        }
    }, [kind, isEditing]);

    // ── Duplicate hydration ────────────────────────────────────────────────
    // When the ⋮ → Duplicate flow lands on this /new page, it stashes a
    // payload in sessionStorage.  We consume + clear it on mount so a manual
    // refresh starts blank.  Pure UI: no DB write happens until Save.
    useEffect(() => {
        if (isEditing) return;
        const dup = consumeDuplicate(kind);
        if (!dup) return;
        setDate(dup.date);
        setNarration(dup.narration ?? "");
        if (dup.partyAccountId != null) setTopLedgerId(dup.partyAccountId);
        // Map source lines back into top + particulars rows (same shape as
        // the edit-mode prefill).
        const sourceLines = dup.lines as { accountId?: number | null; type?: "DEBIT" | "CREDIT"; amount?: number | string; description?: string | null }[];
        const topLine    = sourceLines.find((l) => l.type === copy.topSide && l.accountId != null);
        const rowLines   = sourceLines.filter((l) => l.type === copy.rowSide);
        if (topLine?.accountId != null) setTopLedgerId(topLine.accountId);
        if (rowLines.length > 0) {
            setRows(rowLines.map((l) => ({
                id:        ++rowSeq,
                accountId: l.accountId ?? null,
                amount:    l.amount != null ? String(Number(l.amount)) : "",
                note:      l.description ?? "",
            })));
        }
        toast.success("Duplicated — review and Save to create a new voucher");
        // Run once on mount; intentionally not in deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Prefill in edit mode ────────────────────────────────────────────────
    useEffect(() => {
        if (!isEditing || voucherId == null) return;
        let cancelled = false;
        setLoading(true);
        axios.get<LoadedVoucher>(`/api/accountancy/vouchers/${voucherId}`)
            .then((r) => {
                if (cancelled) return;
                const v = r.data;
                setLoadedVoucher(v);
                setDate(v.date.slice(0, 10));
                setNarration(v.narration ?? "");

                // Split lines using PER_KIND[kind] — first topSide line is the
                // "top" account; remaining rowSide lines become the particulars.
                const topLine = v.lines.find((l) => l.type === copy.topSide);
                const rowLines = v.lines.filter((l) => l.type === copy.rowSide);

                if (topLine) setTopLedgerId(topLine.accountId);
                setRows(
                    rowLines.length > 0
                        ? rowLines.map((l) => ({
                            id:        ++rowSeq,
                            accountId: l.accountId,
                            amount:    String(Number(l.amount)),
                            note:      l.description ?? "",
                        }))
                        : [newRow()],
                );

                // Snapshot original for dirty-check
                originalSnapshotRef.current = {
                    date:      v.date.slice(0, 10),
                    narration: (v.narration ?? "").trim(),
                    lines:     normalizeLines(v.lines.map((l) => ({
                        accountId:   l.accountId,
                        type:        l.type,
                        amount:      Number(l.amount),
                        description: l.description,
                    }))),
                };
            })
            .catch(() => toast.error("Failed to load voucher"))
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isEditing, voucherId, copy.topSide, copy.rowSide, reloadCounter]);

    const updateRow = (id: number, patch: Partial<Row>) =>
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const addRow = () => setRows((rs) => [...rs, newRow()]);
    const removeRow = (id: number) => setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.id !== id)));

    const submit = async (postAfterSave: boolean) => {
        if (!balanced) {
            toast.error("Pick the top account and at least one particulars row with an amount.");
            return;
        }

        const topLine = {
            accountId: effectiveTopAccountId!,
            type:      copy.topSide,
            amount:    rowsTotal,
        };
        const rowLines = rows.map((r) => ({
            accountId:   r.accountId!,
            type:        copy.rowSide,
            amount:      parseAmount(r.amount),
            description: r.note.trim() || undefined,
        }));
        const allLines = [topLine, ...rowLines];

        // ── Edit mode: dirty-check then PATCH ───────────────────────────────
        if (isEditing && voucherId != null) {
            const current: Snapshot = {
                date,
                narration: narration.trim(),
                lines:     normalizeLines(allLines),
            };
            const original = originalSnapshotRef.current;
            if (original && snapshotsEqual(original, current)) {
                toast("No changes to save");
                closeForm();
                return;
            }

            setSaving(true);
            try {
                await axios.patch(`/api/accountancy/vouchers/${voucherId}`, {
                    date,
                    narration: narration.trim() || undefined,
                    lines:     allLines,
                });
                toast.success(`${copy.title} ${loadedVoucher?.reference ?? ""} updated`);
                closeForm();
            } catch (err: unknown) {
                const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Save failed";
                toast.error(msg ?? "Save failed");
            } finally {
                setSaving(false);
            }
            return;
        }

        // ── Create mode: POST (+ optional post) ─────────────────────────────
        setSaving(true);
        try {
            const created = await axios.post<{ id: number; reference: string }>(
                "/api/accountancy/vouchers",
                {
                    type:      kind,
                    date,
                    narration: narration.trim() || undefined,
                    lines:     allLines,
                },
            );
            if (postAfterSave) {
                await axios.post(`/api/accountancy/vouchers/${created.data.id}/post`);
                toast.success(`${copy.title} ${created.data.reference} saved & posted`);
            } else {
                toast.success(`${copy.title} ${created.data.reference} saved as draft`);
            }
            router.push(copy.listPath);
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : "Save failed";
            toast.error(msg ?? "Save failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col flex-1 min-h-0 bg-background" onChange={() => { isDirtyRef.current = true; }}>
            {/* Breadcrumb bar */}
            <VoucherTopBar
                title={copy.title}
                onClose={handleClose}
                statusBadge={isEditing && loadedVoucher
                    ? { label: loadedVoucher.status, colorClass: JOURNAL_STATUS_COLORS[loadedVoucher.status] }
                    : undefined}
                rightContent={
                    <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-2">
                            <label className="text-muted-foreground uppercase tracking-wide">No.</label>
                            <span className="font-mono tabular-nums px-2 py-1 rounded bg-muted/40 border border-border min-w-[140px] text-center">
                                {isEditing
                                    ? (loadedVoucher?.reference ?? (loading ? "Loading…" : "—"))
                                    : (nextRef || "Generating…")}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-muted-foreground uppercase tracking-wide">Date</label>
                            <Input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="h-8 w-40 text-xs"
                            />
                        </div>
                    </div>
                }
            />

            {/* Body — Tally-finish: two columns (Particulars wide / Amount right) */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
                <div className="max-w-3xl mx-auto space-y-6">

                    {/* Top side — single first line. Dr/Cr prefix in grey, then picker, then amount. */}
                    <div className="space-y-2">
                        <div className="grid grid-cols-[40px_minmax(0,1fr)_160px] items-start gap-3 pb-2 border-b border-border/60">
                            <span className="pt-2 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                                {copy.topSide === "DEBIT" ? "Dr" : "Cr"}
                            </span>
                            <div>
                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1">{copy.topLabel}</p>
                                {copy.topPickerKind === "party" && !isEditing ? (
                                    <>
                                        <PartySearchAndCreate
                                            ref={partyPickerRef}
                                            onPicked={setTopParty}
                                            locked={!!topParty}
                                            placeholder={copy.topPlaceholder}
                                            partyGroup={copy.partyGroup}
                                            allowIncludeOther
                                        />
                                        {topParty && (
                                            <button
                                                type="button"
                                                onClick={() => { setTopParty(null); partyPickerRef.current?.clear(); }}
                                                className="mt-1 text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                                            >
                                                Clear &times;
                                            </button>
                                        )}
                                    </>
                                ) : copy.topPickerKind === "party" && isEditing ? (
                                    // Edit mode for CREDIT_NOTE / DEBIT_NOTE — party is locked, show as read-only.
                                    <div className="h-9 px-3 flex items-center rounded border border-border bg-muted/30 text-sm">
                                        {topAccount?.name ?? loadedVoucher?.partyAccount?.name ?? "—"}
                                        <span className="ml-auto text-[10px] text-muted-foreground uppercase">Locked</span>
                                    </div>
                                ) : (
                                    <GlAccountCombobox
                                        value={topLedgerId}
                                        onChange={(a) => setTopLedgerId(a?.id ?? null)}
                                        accounts={topAccounts}
                                        placeholder={copy.topPlaceholder}
                                    />
                                )}
                                <BalanceHint account={topAccount} />
                            </div>
                            <div className="pt-6 text-right font-mono tabular-nums text-sm">
                                {topTotal > 0 ? `₹ ${fmt(topTotal)}` : <span className="text-muted-foreground/40">—</span>}
                            </div>
                        </div>
                    </div>

                    {/* Particulars rows */}
                    <div className="space-y-1">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium px-1">{copy.rowsHeader}</p>
                        <table className="w-full">
                            <thead>
                                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                    <th className="w-8 px-1 py-1 text-left font-medium">#</th>
                                    <th className="px-2 py-1 text-left font-medium">{copy.rowSide === "DEBIT" ? "Dr" : "Cr"} · Particulars</th>
                                    <th className="w-40 px-2 py-1 text-right font-medium">Amount</th>
                                    <th className="w-8 px-1 py-1" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, i) => {
                                    const acct = row.accountId ? accountById.get(row.accountId) : undefined;
                                    return (
                                        <tr key={row.id} className="border-t border-border/40 align-top">
                                            <td className="px-1 py-2 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                                            <td className="px-2 py-2">
                                                <GlAccountCombobox
                                                    value={row.accountId}
                                                    onChange={(a) => updateRow(row.id, { accountId: a?.id ?? null })}
                                                    accounts={rowAccounts}
                                                    placeholder={copy.rowPlaceholder}
                                                />
                                                <BalanceHint account={acct} />
                                                <Input
                                                    value={row.note}
                                                    onChange={(e) => updateRow(row.id, { note: e.target.value })}
                                                    placeholder="Note (optional)"
                                                    className="h-7 text-xs mt-1"
                                                />
                                            </td>
                                            <td className="px-2 py-2">
                                                <Input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={row.amount}
                                                    placeholder="0.00"
                                                    onChange={(e) => {
                                                        if (isAmountChars(e.target.value)) {
                                                            updateRow(row.id, { amount: e.target.value });
                                                        }
                                                    }}
                                                    className="h-8 text-right tabular-nums font-mono"
                                                />
                                            </td>
                                            <td className="px-1 py-2 text-center">
                                                {rows.length > 1 && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon-xs"
                                                        onClick={() => removeRow(row.id)}
                                                        className="text-destructive/50 hover:text-destructive"
                                                        title="Remove row"
                                                    >
                                                        <Trash2 size={13} />
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div className="px-1 pt-2">
                            <Button variant="ghost" size="sm" onClick={addRow} className="h-auto py-1 text-xs text-primary">
                                <Plus size={12} className="mr-1" /> Add Row
                            </Button>
                        </div>
                    </div>

                    {/* Totals strip */}
                    <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
                        <div className="flex items-center justify-end gap-6 text-sm">
                            <span className="text-muted-foreground">Dr</span>
                            <span className="font-mono tabular-nums">
                                ₹ {fmt(copy.topSide === "DEBIT" ? topTotal : rowsTotal)}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-muted-foreground">Cr</span>
                            <span className="font-mono tabular-nums">
                                ₹ {fmt(copy.topSide === "CREDIT" ? topTotal : rowsTotal)}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            {balanced ? (
                                <span className="flex items-center gap-1 text-green-600 font-medium">
                                    <CheckCircle2 size={14} /> Balanced
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 text-amber-600">
                                    <X size={14} /> Incomplete
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Narration + amount-in-words — Tally convention */}
                    <div className="space-y-1">
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Narration</label>
                        <Input
                            value={narration}
                            onChange={(e) => setNarration(e.target.value)}
                            placeholder={copy.narrationPlaceholder}
                            className="h-9"
                        />
                        {rowsTotal > 0 && (
                            <p className="text-[11px] text-muted-foreground italic pt-1">
                                Amount: <span className="not-italic">{numberToIndianWords(rowsTotal)}</span>
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Sticky action bar */}
            <VoucherActionBar
                onCancel={closeForm}
                onSave={() => submit(true)}
                saveLabel={isEditing ? "Save Changes" : "Save"}
                saveDisabled={saving || !balanced || loading || (isEditing && (loadedVoucher?.status === "CANCELLED" || !!loadedVoucher?.deletedAt))}
                onSaveDraft={() => submit(false)}
                showSaveDraft={!isEditing}
                saveDraftDisabled={saving || !balanced}
                saving={saving}
                leftContent={isEditing && loadedVoucher ? (
                    <div className="mr-auto flex items-center gap-3">
                        <LifecycleActions
                            voucher={loadedVoucher}
                            apiBasePath={`/api/accountancy/vouchers/${voucherId}`}
                            listPath={copy.listPath}
                            label={copy.title}
                            canCancel={canCancel}
                            canDelete={canDelete}
                            canHardDelete={canHardDelete}
                            onChanged={() => setReloadCounter((c) => c + 1)}
                        />
                        {loadedVoucher.status === "POSTED" && !loadedVoucher.deletedAt && !loadedVoucher.cancelledAt && (
                            <span className="text-[11px] text-amber-600 italic">
                                Will reverse + re-post on save (reference preserved)
                            </span>
                        )}
                    </div>
                ) : undefined}
            />
            <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
                <DialogContent showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle>Unsaved changes</DialogTitle>
                        <DialogDescription>You have unsaved changes that will be lost if you leave now.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCloseDialogOpen(false)}>Stay</Button>
                        <Button variant="outline" onClick={async () => { setCloseDialogOpen(false); isDirtyRef.current = false; await submit(false); }}>Save Draft</Button>
                        <Button variant="destructive" onClick={() => { isDirtyRef.current = false; setCloseDialogOpen(false); closeForm(); }}>Discard &amp; Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

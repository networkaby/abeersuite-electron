"use client";

// Tally-finish full-page voucher form for the five pure-GL voucher kinds
// (Payment, Receipt, Contra, Credit Note, Debit Note). Per-kind COPY config
// drives labels / Dr-Cr sides / account filters. Layout: compact top strip,
// two-column Particulars / Amount body, balance indicator + amount-in-words,
// sticky footer. Create-only.

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
import { Checkbox } from "@/components/ui/checkbox";
import { fmt, JOURNAL_STATUS_COLORS } from "@/utils/constants";
import { parseAmount, isAmountChars } from "@/utils/numberInput";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { extractApiError } from "@/shared/lib/api";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { requiredVoucherPermission } from "@/shared/lib/auth/voucherMatrix";
import { consumeDuplicate } from "@/modules/accountancy/lib/duplicate";
import { voucherPrintPageHref } from "@/modules/accountancy/lib/voucherUrls";
import { printAfterSaveDefault, thermalDefault } from "@/shared/lib/print/voucherTemplateDefaults";
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
import { round2 } from "@/shared/lib/format/moneyInr";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { getOrgDefaults } from "@/shared/lib/orgDefaults";
import { parseDenomJson, type DenomJson } from "@/shared/lib/accountancy/denomJson";

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
    /** Contra deposit-slip capture (final combined breakdown) — see denomJson.ts. */
    denomJson?:     unknown;
};

// Normalized line for dirty-check comparison.
type SnapLine = { accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description: string };
type Snapshot = { date: string; narration: string; lines: SnapLine[] };

function normalizeLines(lines: { accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description?: string | null }[]): SnapLine[] {
    return lines
        .map((l) => ({
            accountId:   l.accountId,
            type:        l.type,
            amount:      round2(l.amount),
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
        topLabel:             "Transfer to",
        rowsHeader:           "Transfer from",
        topPlaceholder:       "Cash-in-Hand / Bank Account…",
        rowPlaceholder:       "Cash-in-Hand / Bank Account…",
        narrationPlaceholder: "e.g. Deposit cash to HDFC current account",
        topSide:              "DEBIT",
        rowSide:              "CREDIT",
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
    // Cheque number — required when this is a cheque row. Cheque-ness is DERIVED,
    // not toggled: when depositing to a bank (denomination on, Transfer-to = bank),
    // a Cash Transfer-from is counted by notes and a BANK Transfer-from is a cheque
    // (you can't hand another bank's balance at the counter). See isChequeRow().
    chequeNo?: string;
};

let rowSeq = 0;
const newRow = (): Row => ({ id: ++rowSeq, accountId: null, amount: "", note: "" });

// ── Contra denomination capture ─────────────────────────────────────────────
// While the "Denomination details" box is ticked (auto-on when Transfer-to is
// a bank), each CASH "Transfer from" row gets a note-counting panel in the side
// space and its amount is LOCKED to the counted total. A CHEQUE is a separate
// Transfer-from row marked with the "Cheque" toggle (its ledger = the drawer's
// account, its amount typed). At save the cash notes merge note-wise and the
// cheque rows collect into ONE final DenomJson stored on the spine.

type RowDenom = { counts: Record<number, string> };  // denomination → count (input string)
const emptyRowDenom = (): RowDenom => ({ counts: {} });
const FALLBACK_DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];

const rowDenomTotal = (d: RowDenom): number =>
    Object.entries(d.counts).reduce((s, [den, c]) => s + Number(den) * (parseInt(c || "0", 10) || 0), 0);

/** One cash row's note-counting panel — counts per denomination + running total. */
function DenomPanel({ title, denomList, value, onChange }: {
    title:     string;
    denomList: number[];
    value:     RowDenom;
    onChange:  (updater: (d: RowDenom) => RowDenom) => void;
}) {
    return (
        <div className="rounded-md border border-border bg-card p-3 space-y-2 shadow-sm">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{title}</p>
            <table className="w-full text-xs">
                <tbody>
                    {denomList.map((d) => {
                        const c = parseInt(value.counts[d] || "0", 10) || 0;
                        return (
                            <tr key={d}>
                                <td className="w-16 py-0.5 pr-2 text-right font-mono tabular-nums text-muted-foreground">{d} &times;</td>
                                <td className="w-16 py-0.5">
                                    <Input
                                        value={value.counts[d] ?? ""}
                                        inputMode="numeric"
                                        placeholder="0"
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            if (/^\d*$/.test(v)) onChange((dd) => ({ ...dd, counts: { ...dd.counts, [d]: v } }));
                                        }}
                                        className="h-6 text-right text-xs font-mono"
                                    />
                                </td>
                                <td className="py-0.5 pl-2 text-right font-mono tabular-nums text-muted-foreground">
                                    {c > 0 ? fmt(d * c) : ""}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <div className="flex justify-between border-t border-border pt-1.5 text-xs font-medium">
                <span>Total</span>
                <span className="font-mono tabular-nums">₹ {fmt(rowDenomTotal(value))}</span>
            </div>
        </div>
    );
}

// ── Component ───────────────────────────────────────────────────────────────

export function GlVoucherPage({ kind, voucherId }: { kind: MoneyFlowKind; voucherId?: number }) {
    const router = useRouter();
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    // Per-kind eligibility (generic key OR the kind-specific key). Removal is one
    // action now (soft-delete retired) — both LifecycleActions delete props map to it.
    const vCancel = requiredVoucherPermission(kind, "cancel");
    const vDelete = requiredVoucherPermission(kind, "delete");
    const vPost   = requiredVoucherPermission(kind, "post");
    const holds = (p: string | null) => p != null && hasPermissionWithScope(permissions, p);
    const canCancel     = holds(vCancel);
    const canDelete     = holds(vDelete);
    const canHardDelete = canDelete;
    // Posting is a separate permission. A create-but-not-post user keeps only the
    // Save Draft button — the Save (finalise) button is hidden so they can't try
    // an action that would 403.
    const canPost       = holds(vPost);

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
    const [date, setDate] = useState(() => toIsoDate(new Date()));
    const [narration, setNarration] = useState("");
    // "Print after save" + "Thermal" toggles — seeded from the central per-kind
    // soft switches.
    const [printAfterSave, setPrintAfterSave] = useState(() => printAfterSaveDefault(kind));
    const [thermal, setThermal] = useState(() => thermalDefault(kind));

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

    // ── Contra deposit-slip capture ─────────────────────────────────────────
    const isContra = kind === "CONTRA";
    const [denomOn, setDenomOn]     = useState(false);
    const [denomList, setDenomList] = useState<number[]>(FALLBACK_DENOMS);
    const [rowDenoms, setRowDenoms] = useState<Record<number, RowDenom>>({});
    // Cheques loaded from a saved voucher, awaiting the accounts list so they can
    // be matched back onto their Transfer-from rows (drawer + amount).
    const [pendingCheques, setPendingCheques] = useState<DenomJson["cheques"] | null>(null);

    const accountById = new Map<number, GlAccount>(accounts.map((a) => [a.id, a]));
    const topAccounts = accounts.filter(copy.topFilter);
    const rowAccounts = accounts.filter(copy.rowFilter);
    const topAccount  = effectiveTopAccountId ? accountById.get(effectiveTopAccountId) : undefined;

    const topIsBank  = isContra && topAccount?.group?.name === ACCOUNT_GROUPS.BANK_ACCOUNTS;
    const isCashAcct = (a?: GlAccount) => a?.group?.name === ACCOUNT_GROUPS.CASH_IN_HAND;
    // Cash "Transfer from" rows — each gets its own side panel while capture is on.
    const cashRows = isContra && denomOn
        ? rows.filter((r) => isCashAcct(r.accountId ? accountById.get(r.accountId) : undefined))
        : [];
    const showDenomPanels = cashRows.length > 0;
    // At least one Transfer-from is cash → this contra moves physical cash, so
    // the denomination option is meaningful (deposit to bank, or cash handover).
    // A bank → cash withdrawal has no cash source and doesn't offer it.
    const hasCashSource = isContra && rows.some((r) => isCashAcct(r.accountId ? accountById.get(r.accountId) : undefined));
    const showDenomToggle = topIsBank || hasCashSource;

    // Depositing to a bank with denomination on: a Cash Transfer-from is counted
    // by notes; a BANK Transfer-from is DEFINITELY a cheque (you can't hand
    // another bank's balance at the counter), so it demands a cheque number.
    const isChequeRow = (r: Row): boolean => {
        if (!(isContra && denomOn && topIsBank) || r.accountId == null) return false;
        const acct = accountById.get(r.accountId);
        return acct != null && !isCashAcct(acct);
    };
    // Every cheque row must carry a cheque number before the voucher can save.
    const chequesComplete = rows.every((r) => !isChequeRow(r) || (r.chequeNo ?? "").trim().length > 0);

    const rowsTotal = rows.reduce((s, r) => s + parseAmount(r.amount), 0);
    const topTotal  = rowsTotal;  // top side auto-derives from particulars sum
    const balanced  = rowsTotal > 0
        && rows.every((r) => r.accountId !== null && parseAmount(r.amount) > 0)
        && !!effectiveTopAccountId
        // top account can't equal any particulars account (would self-balance)
        && rows.every((r) => r.accountId !== effectiveTopAccountId)
        && chequesComplete;

    // Org's note/coin list for the denomination panels (same as shift close).
    useEffect(() => {
        if (!isContra) return;
        getOrgDefaults()
            .then((od) => setDenomList(od.cashDenominationsJson?.length ? od.cashDenominationsJson : FALLBACK_DENOMS))
            .catch(() => setDenomList(FALLBACK_DENOMS));
    }, [isContra]);

    // Transfer-to is a bank → denomination capture auto-ticks (user can untick);
    // switching the destination off a bank unticks it again.
    useEffect(() => {
        if (isContra) setDenomOn(topIsBank);
    }, [isContra, topIsBank]);

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
                const mappedRows = rowLines.length > 0
                    ? rowLines.map((l) => ({
                        id:        ++rowSeq,
                        accountId: l.accountId,
                        amount:    String(Number(l.amount)),
                        note:      l.description ?? "",
                    }))
                    : [newRow()];
                setRows(mappedRows);

                // Contra: reload the saved capture. Notes are combined-only, so
                // they prefill the FIRST cash row's panel (single-cash-row deposit
                // is the normal case). Cheques need the accounts list to match
                // rows by drawer, which may load after this — so stash them and let
                // a dedicated effect re-mark the rows once accounts are ready.
                if (kind === "CONTRA") {
                    const saved = parseDenomJson(v.denomJson);
                    if (saved && mappedRows.length > 0) {
                        setDenomOn(true);
                        setRowDenoms({
                            [mappedRows[0].id]: {
                                counts: Object.fromEntries(Object.entries(saved.notes).map(([k, c]) => [k, String(c)])),
                            },
                        });
                        setPendingCheques(saved.cheques);
                    }
                }

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
    }, [isEditing, voucherId, kind, copy.topSide, copy.rowSide, reloadCounter]);

    // Re-mark cheque rows once BOTH the saved cheques and the accounts list are
    // available (they load independently). Match each cheque to a row by drawer
    // account (when stored) and amount, then clear the pending list.
    useEffect(() => {
        if (pendingCheques == null || pendingCheques.length === 0 || accounts.length === 0) return;
        const byId = new Map(accounts.map((a) => [a.id, a]));
        setRows((rs) => {
            const used = new Set<number>();
            return rs.map((r) => {
                const acct = r.accountId != null ? byId.get(r.accountId) : undefined;
                // Only bank (non-cash) rows carry cheques; cash rows are notes.
                if (acct == null || isCashAcct(acct)) return r;
                const acctName = acct.name;
                const idx = pendingCheques.findIndex((c, i) =>
                    !used.has(i)
                    && Math.abs((parseAmount(r.amount) || 0) - c.amount) < 0.005
                    && (c.account == null || c.account === acctName));
                if (idx < 0) return r;
                used.add(idx);
                return { ...r, chequeNo: pendingCheques[idx].no };
            });
        });
        setPendingCheques(null);
    }, [pendingCheques, accounts]);

    const updateRow = (id: number, patch: Partial<Row>) =>
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const addRow = () => setRows((rs) => [...rs, newRow()]);
    const removeRow = (id: number) => setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.id !== id)));

    // Panel edit → the cash row's amount follows the counted total (locked).
    const setRowDenom = (rowId: number, updater: (d: RowDenom) => RowDenom) => {
        const next = updater(rowDenoms[rowId] ?? emptyRowDenom());
        setRowDenoms((prev) => ({ ...prev, [rowId]: next }));
        const total = rowDenomTotal(next);
        updateRow(rowId, { amount: total > 0 ? String(round2(total)) : "" });
        isDirtyRef.current = true;
    };

    // Checkbox toggle: turning capture ON re-locks every cash row's amount to
    // its panel total; turning it OFF frees plain typing (amounts stay put).
    const toggleDenom = (on: boolean) => {
        setDenomOn(on);
        if (on) {
            for (const r of rows) {
                const acct = r.accountId ? accountById.get(r.accountId) : undefined;
                if (!isCashAcct(acct)) continue;
                const total = rowDenomTotal(rowDenoms[r.id] ?? emptyRowDenom());
                updateRow(r.id, { amount: total > 0 ? String(round2(total)) : "" });
            }
        }
    };

    // Merge the capture into the FINAL combined breakdown stored on the spine:
    // note counts from the CASH rows' panels (summed note-wise) + one entry per
    // CHEQUE row (drawer account · cheque no · amount). Null when capture is off
    // or nothing was entered → print falls back to the blank pen-fill slip.
    const buildDenomPayload = (): DenomJson | null => {
        if (!isContra || !denomOn) return null;
        const notes: Record<string, number> = {};
        const cheques: { no: string; amount: number; account?: string }[] = [];
        for (const r of rows) {
            const acct = r.accountId ? accountById.get(r.accountId) : undefined;
            if (isCashAcct(acct)) {
                const d = rowDenoms[r.id];
                if (!d) continue;
                for (const [den, c] of Object.entries(d.counts)) {
                    const cnt = parseInt(c || "0", 10) || 0;
                    if (cnt > 0) notes[den] = (notes[den] ?? 0) + cnt;
                }
            } else if (isChequeRow(r)) {
                const amt = parseAmount(r.amount) || 0;
                if ((r.chequeNo ?? "").trim() && amt > 0) {
                    cheques.push({ no: r.chequeNo!.trim(), amount: amt, account: acct?.name });
                }
            }
        }
        return Object.keys(notes).length || cheques.length ? { notes, cheques } : null;
    };

    // Open the saved voucher's print page in a new tab — thermal auto-fire (like
    // POS) or the browser print page, per the Thermal toggle.
    const openReceipt = (id: number) =>
        window.open(voucherPrintPageHref("gl", id, { thermal }), "_blank", "noopener");

    const submit = async (postAfterSave: boolean, print = false) => {
        if (!chequesComplete) {
            toast.error("Enter the cheque number for each bank Transfer-from row.");
            return;
        }
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
                    // Contra: null clears a stale capture when the box is unticked.
                    ...(isContra ? { denomJson: buildDenomPayload() } : {}),
                });
                toast.success(`${copy.title} ${loadedVoucher?.reference ?? ""} updated`);
                if (print) openReceipt(voucherId);
                closeForm();
            } catch (err: unknown) {
                toast.error(extractApiError(err, "Save failed"));
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
                    ...(isContra ? { denomJson: buildDenomPayload() } : {}),
                },
            );
            if (postAfterSave) {
                await axios.post(`/api/accountancy/vouchers/${created.data.id}/post`);
                toast.success(`${copy.title} ${created.data.reference} saved & posted`);
            } else {
                toast.success(`${copy.title} ${created.data.reference} saved as draft`);
            }
            if (print) openReceipt(created.data.id);
            // Reset for the next voucher instead of navigating away — same as the
            // Sale form: the user can punch in the next entry without leaving.
            // Cancel / Close X are the explicit exits to the register.
            setNarration("");
            setTopLedgerId(null);
            setTopParty(null);
            partyPickerRef.current?.clear();
            setRows([newRow()]);
            setRowDenoms({});
            setDate(toIsoDate(new Date()));
            isDirtyRef.current = false;
            // Refresh the voucher-number preview so the next entry shows the
            // freshly-incremented reference (otherwise nextRef stays stale).
            axios.get<{ reference: string }>(`/api/accountancy/vouchers/next-ref?type=${kind}`)
                .then((r) => setNextRef(r.data.reference))
                .catch(() => { /* keep last value */ });
            router.refresh();
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Save failed"));
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
                            <TallyDateInput
                                value={date}
                                onValueChange={setDate}
                                className="h-8 w-40 text-xs"
                            />
                        </div>
                    </div>
                }
            />

            {/* Body — Tally-finish: two columns (Particulars wide / Amount right).
                Contra denomination capture docks its counting panels in the free
                space beside the form (one panel per cash Transfer-from row). */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
                <div className={`mx-auto flex items-start gap-8 ${showDenomPanels ? "max-w-6xl" : "max-w-3xl"}`}>
                <div className="min-w-0 flex-1 space-y-6">

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
                                {/* Denomination capture — offered whenever the contra
                                    moves physical cash (deposit to bank, or a cash-to-
                                    cash handover). Ticked → cash amounts come from the
                                    denomination panels, not plain typing. Auto-ticks
                                    for a bank deposit; opt-in for a cash handover. */}
                                {showDenomToggle && (
                                    <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                                        <Checkbox
                                            checked={denomOn}
                                            onCheckedChange={(v) => toggleDenom(v === true)}
                                        />
                                        {topIsBank
                                            ? "Denomination details — cash amounts locked to the counted total; unticked prints a blank pen-fill slip"
                                            : "Denomination details — count the cash and print a handover slip; unticked keeps a plain voucher"}
                                    </label>
                                )}
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
                                    // Capture on + cash source → the amount comes from
                                    // the side panel, plain typing is off.
                                    const denomLocked = isContra && denomOn && isCashAcct(acct);
                                    return (
                                        <tr key={row.id} className="border-t border-border/40 align-top">
                                            <td className="px-1 py-2 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                                            <td className="px-2 py-2">
                                                <GlAccountCombobox
                                                    value={row.accountId}
                                                    onChange={(a) => {
                                                        // Switching onto a cash ledger while capture is
                                                        // on re-locks the amount to that row's panel.
                                                        const lockNow = isContra && denomOn && isCashAcct(a ?? undefined);
                                                        const total = lockNow ? rowDenomTotal(rowDenoms[row.id] ?? emptyRowDenom()) : null;
                                                        updateRow(row.id, {
                                                            accountId: a?.id ?? null,
                                                            ...(lockNow ? { amount: total && total > 0 ? String(round2(total)) : "" } : {}),
                                                        });
                                                    }}
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
                                                {/* Bank Transfer-from in a deposit = a cheque. No toggle:
                                                    it credits this row's ledger and prints in the slip's
                                                    cheque section, with a REQUIRED cheque number. */}
                                                {isChequeRow(row) && (
                                                    <div className="mt-1 flex items-center gap-2">
                                                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">Cheque no.<span className="text-destructive"> *</span></span>
                                                        <Input
                                                            value={row.chequeNo ?? ""}
                                                            onChange={(e) => updateRow(row.id, { chequeNo: e.target.value })}
                                                            placeholder="e.g. 483920"
                                                            className={`h-7 text-xs flex-1${(row.chequeNo ?? "").trim() ? "" : " border-destructive/60"}`}
                                                        />
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-2 py-2">
                                                <Input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={row.amount}
                                                    placeholder={denomLocked ? "Via denoms →" : "0.00"}
                                                    disabled={denomLocked}
                                                    title={denomLocked ? "Amount follows the denomination panel" : undefined}
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

                {/* Denomination panels — one per cash Transfer-from row; the
                    combined result is what the deposit slip prints. */}
                {showDenomPanels && (
                    <aside className="w-[300px] shrink-0 space-y-4 sticky top-0">
                        {cashRows.map((r) => (
                            <DenomPanel
                                key={r.id}
                                title={`${r.accountId ? (accountById.get(r.accountId)?.name ?? "Cash") : "Cash"} — Denominations`}
                                denomList={denomList}
                                value={rowDenoms[r.id] ?? emptyRowDenom()}
                                onChange={(updater) => setRowDenom(r.id, updater)}
                            />
                        ))}
                    </aside>
                )}
                </div>
            </div>

            {/* Sticky action bar */}
            <VoucherActionBar
                onCancel={closeForm}
                onSave={() => submit(true, printAfterSave)}
                saveLabel={isEditing ? "Save Changes" : "Save"}
                saveDisabled={saving || !balanced || loading || (isEditing && (loadedVoucher?.status === "CANCELLED" || !!loadedVoucher?.deletedAt))}
                onSaveDraft={() => submit(false, printAfterSave)}
                showSaveDraft={!isEditing}
                showPrintToggle
                printAfterSave={printAfterSave}
                onPrintAfterSaveChange={setPrintAfterSave}
                showThermalToggle
                thermal={thermal}
                onThermalChange={setThermal}
                showSave={isEditing || canPost}
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

"use client";

// Tally-finish full-page voucher form for the five pure-GL voucher kinds
// (Payment, Receipt, Contra, Credit Note, Debit Note). Per-kind COPY config
// drives labels / Dr-Cr sides / account filters. Layout: compact top strip,
// two-column Particulars / Amount body, sticky footer. Payment / Receipt are
// the counter-friendly pair: no Dr/Cr chrome, an always-present blank entry
// row (Tally-style, Enter walks down), an optional payment instrument on each
// particulars row (one party may pay by UPI, the next by cheque), a note box
// that shows only for the row in hand, and the last-used Cash/Bank ledger
// remembered per kind.
// Create + edit (PATCH).

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Plus, Trash2, CheckCircle2, X, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogDescription,
    DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { fmt } from "@/shared/lib/format/moneyInr";
import { JOURNAL_STATUS_COLORS } from "@/shared/lib/constants/badges";
import { parseAmount, isAmountChars } from "@/utils/numberInput";
import { ACCOUNT_GROUPS, PAYMENT_INSTRUMENTS, type PaymentInstrument } from "@/shared/lib/constants/accounting";
import { extractApiError } from "@/shared/lib/api";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { requiredVoucherPermission } from "@/shared/lib/auth/voucherMatrix";
import { consumeDuplicate, peekDuplicate } from "@/modules/accountancy/lib/duplicate";
import {
    isMoneyGroupName,
    isBankLikeGroupName,
    MONEY_ACCOUNT_PLACEHOLDER,
} from "@/modules/accountancy/lib/moneyAccount";
import { printVoucherAfterSave } from "@/shared/lib/print/silentThermalPrint";
import { printAfterSaveDefault, thermalDefault } from "@/shared/lib/print/voucherTemplateDefaults";
import { GlAccountCombobox, type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { BalanceHint } from "@/modules/accountancy/components/BalanceHint";
import { LifecycleActions } from "@/modules/accountancy/components/LifecycleActions";
import { BillLinkDialog, clearBillLinkCache } from "@/modules/accountancy/components/BillLinkDialog";
import { settleFromPicks } from "@/modules/accountancy/lib/settleFromPicks";
import { EPS } from "@/modules/accountancy/lib/billLinkPlan";
import { OpenBillsPanel, clearOpenBillsCache, type BillPicks } from "@/modules/accountancy/components/OpenBillsPanel";
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
import { useGlAccounts } from "@/shared/hooks/useGlAccounts";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { getOrgDefaults } from "@/shared/lib/orgDefaults";
import { parseDenomJson, type DenomJson } from "@/shared/lib/accountancy/denomJson";

// ── Loaded voucher shape (used in edit mode) ────────────────────────────────

type LoadedLine = {
    accountId:   number;
    type:        "DEBIT" | "CREDIT";
    amount:      number | string;
    description: string | null;
    /** Payment instrument — on the particulars rows of a Payment / Receipt. */
    method?:     string | null;
    reference?:  string | null;
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
    partyAccount:   { id: number; name: string } | null;
    lines:          LoadedLine[];
    /** Contra deposit-slip capture (final combined breakdown) — see denomJson.ts. */
    denomJson?:     unknown;
};

// Normalized line for dirty-check comparison.
// `instrument` = "<method>|<reference>" of the line ("" when none).
type SnapLine = { accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description: string; instrument: string };
// `denom` = the deposit-slip capture as a stable key — a Payment's note count
// never moves its lines, so without it a count-only edit read as "no changes".
type Snapshot = { date: string; narration: string; lines: SnapLine[]; denom: string };
const denomKey = (d: DenomJson | null): string => d
    ? JSON.stringify([
        Object.entries(d.notes).filter(([, c]) => c > 0).sort(([a], [b]) => Number(a) - Number(b)),
        d.cheques.map((c) => [c.no, round2(c.amount), c.account ?? ""]),
    ])
    : "";
const instrumentKey = (method?: string | null, reference?: string | null) =>
    method || (reference ?? "").trim() ? `${method ?? ""}|${(reference ?? "").trim()}` : "";

function normalizeLines(lines: { accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description?: string | null; method?: string | null; reference?: string | null }[]): SnapLine[] {
    return lines
        .map((l) => ({
            accountId:   l.accountId,
            type:        l.type,
            amount:      round2(l.amount),
            description: (l.description ?? "").trim(),
            instrument:  instrumentKey(l.method, l.reference),
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
    if (a.denom !== b.denom) return false;
    if (a.lines.length !== b.lines.length) return false;
    for (let i = 0; i < a.lines.length; i++) {
        const x = a.lines[i], y = b.lines[i];
        if (x.accountId !== y.accountId) return false;
        if (x.type !== y.type) return false;
        if (Math.abs(x.amount - y.amount) > 0.005) return false;
        if (x.description !== y.description) return false;
        if (x.instrument !== y.instrument) return false;
    }
    return true;
}

// ── Kind + COPY config ──────────────────────────────────────────────────────
// CONTRA folds into the same Kind union as a 5th voucher — same data shape
// (top side + multi particulars rows), only filters and Dr/Cr signs differ.

export type MoneyFlowKind = "PAYMENT" | "RECEIPT" | "CONTRA" | "CREDIT_NOTE" | "DEBIT_NOTE";

/** A bill the form opens on top of: whose it is, what is open on it, and which
 *  voucher it is — exactly what `?partyAccountId=..&amount=..&billId=..` says. */
export type SettleBill = { partyAccountId: number; amount: number; billId: number };

// Cash / Bank / OD — see moneyAccount.ts for why OD belongs with the deposit
// accounts. Payment, Receipt and Contra all draw from this one set.
const isMoneyAccount    = (a: GlAccount) => isMoneyGroupName(a.group?.name);
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
        topPlaceholder:       MONEY_ACCOUNT_PLACEHOLDER,
        rowPlaceholder:       "Party (name or mobile) / expense / income…",
        narrationPlaceholder: "e.g. Office rent for May 2026",
        topSide:              "CREDIT",
        rowSide:              "DEBIT",
        topPickerKind:        "ledger",
        topFilter:            isMoneyAccount,
        rowFilter:            () => true,
        listPath:             "/office/accountancy/vouchers-registers/payments",
    },
    RECEIPT: {
        title:                "Receipt Voucher",
        topLabel:             "Received in",
        rowsHeader:           "Received from",
        topPlaceholder:       MONEY_ACCOUNT_PLACEHOLDER,
        rowPlaceholder:       "Party (name or mobile) / income / refund…",
        narrationPlaceholder: "e.g. Cash received from Acme Corp",
        topSide:              "DEBIT",
        rowSide:              "CREDIT",
        topPickerKind:        "ledger",
        topFilter:            isMoneyAccount,
        rowFilter:            () => true,
        listPath:             "/office/accountancy/vouchers-registers/receipts",
    },
    CONTRA: {
        title:                "Contra Voucher",
        topLabel:             "Transfer to",
        rowsHeader:           "Transfer from",
        topPlaceholder:       MONEY_ACCOUNT_PLACEHOLDER,
        rowPlaceholder:       MONEY_ACCOUNT_PLACEHOLDER,
        narrationPlaceholder: "e.g. Deposit cash to HDFC current account",
        topSide:              "DEBIT",
        rowSide:              "CREDIT",
        topPickerKind:        "ledger",
        topFilter:            isMoneyAccount,
        rowFilter:            isMoneyAccount,
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
    // Payment / Receipt: how THIS party paid (optional) + its number.
    method?:   PaymentInstrument | "";
    reference?: string;
    // Cheque number — required when this is a cheque row. Cheque-ness is DERIVED,
    // not toggled: when depositing to a bank (denomination on, Transfer-to = bank),
    // a Cash Transfer-from is counted by notes and a BANK Transfer-from is a cheque
    // (you can't hand another bank's balance at the counter). See isChequeRow().
    chequeNo?: string;
};

// Owner (2026-09-08): the per-row By / Ref no. columns are hidden for now — the
// row NOTE carries the instrument details until the columns are wanted back.
// Everything behind them (row state, API, print) stays wired; flip to show.
const SHOW_INSTRUMENT_COLUMNS = false;

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

/** One cash row's note-counting panel — counts per denomination + running total.
 *  `target` (Payment) = the amount the count must reach; shows short / excess. */
function DenomPanel({ title, denomList, value, onChange, target }: {
    title:     string;
    denomList: number[];
    value:     RowDenom;
    onChange:  (updater: (d: RowDenom) => RowDenom) => void;
    target?:   number;
}) {
    const gap = target == null ? 0 : round2(rowDenomTotal(value) - target);
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
            {target != null && Math.abs(gap) > 0.005 && (
                <div className="flex justify-between text-xs text-destructive">
                    <span>{gap < 0 ? "Short of payment" : "More than payment"}</span>
                    <span className="font-mono tabular-nums">₹ {fmt(Math.abs(gap))}</span>
                </div>
            )}
        </div>
    );
}

// ── Component ───────────────────────────────────────────────────────────────

/**
 * `onClose` — when set, the form is hosted inside a dialog (Quick Actions
 * click) and every close path (Back, Cancel, Esc, after save) calls it
 * instead of navigating the tab.
 */
export function GlVoucherPage({ kind, voucherId, onClose, onSaved, initialParty = null, settleBill = null }: {
    kind: MoneyFlowKind;
    voucherId?: number;
    onClose?: () => void;
    /** Create mode only: told the new voucher's id once it is saved (and whether
     *  it was posted), for a host that has something to tie it to — the bank
     *  reconciliation screen matches the statement line to it. */
    onSaved?: (voucherId: number, posted: boolean) => void;
    /** Create mode only: a party to start with (the open customer profile).
     *  Payment / Receipt → first particulars row; CN / DN → the top party. */
    initialParty?: PickedParty | null;
    /** Create mode only: the bill this voucher is being made to settle — the
     *  same three values the /new URL carries, for the dialog host which has no
     *  route of its own to put them in. */
    settleBill?: SettleBill | null;
}) {
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();
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
    // an action that would 403. While the session is still loading, permissions is
    // a false empty [] — don't let that flash Save hidden; only narrow down once
    // we actually know.
    const canPost       = sessionStatus === "loading" || holds(vPost);

    const copy = PER_KIND[kind];
    const isEditing = voucherId != null && Number.isFinite(voucherId);

    // Payment/Receipt only: a particulars row can go negative, Tally-style, to
    // fold a same-side deduction (e.g. MDR charge on a card/UPI receipt) into
    // the row list instead of needing a separate voucher. A negative row nets
    // into the top total and, on save, flips to the top account's side.
    const allowNegativeRows = kind === "PAYMENT" || kind === "RECEIPT";
    const parseRowAmount = (s: string | undefined | null): number => {
        if (!allowNegativeRows) return parseAmount(s);
        if (!s) return 0;
        const n = parseFloat(String(s).replace(/[,_\s]/g, ""));
        return Number.isFinite(n) ? n : 0;
    };
    const isRowAmountChars = (s: string): boolean =>
        allowNegativeRows ? /^-?[\d,.\s]*$/.test(s) : isAmountChars(s);

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
        // Hosted in a dialog (Quick Actions click) → the host closes itself.
        if (onClose) { onClose(); return; }
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
            // Another dialog (discard prompt, bill link…) owns Esc — but not the
            // dialog this form itself lives in when opened from Quick Actions.
            const root = rootRef.current;
            const dialogs = Array.from(document.querySelectorAll('[data-state="open"][role="dialog"]'));
            if (dialogs.some((d) => !root || !d.contains(root))) return;
            if (isDirtyRef.current) { setCloseDialogOpen(true); return; }
            closeForm();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // closeForm is stable in effect (router + onClose only).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router, onClose]);
    const rootRef = useRef<HTMLDivElement>(null);
    // The form body's visible height, measured — caps the side column so a long
    // open-bills list plus the note count scroll inside it instead of running
    // off the bottom of a pinned column (dialog and full page differ in height).
    const bodyRef = useRef<HTMLDivElement>(null);
    const [bodyHeight, setBodyHeight] = useState<number | null>(null);
    useEffect(() => {
        const el = bodyRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setBodyHeight(el.clientHeight));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const isDirtyRef = useRef(false);
    const [closeDialogOpen, setCloseDialogOpen] = useState(false);
    const handleClose = () => {
        if (isDirtyRef.current) { setCloseDialogOpen(true); } else { closeForm(); }
    };

    // Accounts loaded once on mount; particulars combobox picks from rowFilter,
    // top picker from topFilter.
    // Shared in-memory list (see useGlAccounts) — instant when already loaded.
    const { accounts } = useGlAccounts({ onError: () => toast.error("Failed to load accounts") });
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

    // Payment / Receipt: the note box shows only for the row being worked on
    // (or one that already has a note) to keep the list short.
    const [focusedRowIdx, setFocusedRowIdx] = useState<number | null>(null);
    const narrationRef = useRef<HTMLInputElement>(null);
    // Focus a particulars row's ledger / amount box by row POSITION (the combobox
    // owns its own input, so we reach it through the row's data attribute; the
    // position, not the client-only row id, keeps server and client HTML equal).
    // A short delay lets the combobox finish its own select-and-refocus first.
    const focusIn = (selector: string) =>
        setTimeout(() => document.querySelector<HTMLInputElement>(selector)?.focus(), 60);
    const focusRowLedger = (idx: number) => focusIn(`[data-row-idx="${idx}"] input`);
    const focusRowAmount = (idx: number) => focusIn(`[data-row-idx="${idx}"] input[data-amount]`);

    // ── Contra deposit-slip capture ─────────────────────────────────────────
    const isContra = kind === "CONTRA";
    const [denomOn, setDenomOn]     = useState(false);
    const [denomList, setDenomList] = useState<number[]>(FALLBACK_DENOMS);
    const [rowDenoms, setRowDenoms] = useState<Record<number, RowDenom>>({});
    // Cheques loaded from a saved voucher, awaiting the accounts list so they can
    // be matched back onto their Transfer-from rows (drawer + amount).
    const [pendingCheques, setPendingCheques] = useState<DenomJson["cheques"] | null>(null);
    // Payment: one count for the whole cash going into the party's bank (the
    // Paid-from cash is a single top ledger, not per-row like Contra).
    const isPayment = kind === "PAYMENT";
    const [payDenom, setPayDenom] = useState<RowDenom>(emptyRowDenom);
    // Edit mode: the tick follows what was saved, so reopening an old cash
    // payment saved without a count doesn't suddenly block its Save.
    const payDenomSavedRef = useRef(false);

    // Payment/Receipt only: "Income/Expenditure" toggle narrows the particulars
    // dropdown to just the relevant P&L ledgers (EXPENSE for Payment, INCOME for
    // Receipt) for the common case of posting a plain expense/income entry —
    // instead of the full chart of accounts. Off by default so party/asset/
    // liability ledgers (e.g. loan repayment, advance to supplier) stay reachable.
    const isPayRec = kind === "PAYMENT" || kind === "RECEIPT";
    const [incomeExpOnly, setIncomeExpOnly] = useState(false);
    const rowNatureType = kind === "PAYMENT" ? "EXPENSE" : "INCOME";

    // Payment / Receipt keep one blank entry row at the bottom (Tally-style: no
    // "Add Row" click — a fresh line appears as soon as the last one is used).
    // Blank rows are ignored for totals, validation and save.
    const isBlankRow = (r: Row) => r.accountId == null && !r.amount.trim() && !r.note.trim() && !r.method && !(r.reference ?? "").trim();
    const activeRows = isPayRec ? rows.filter((r) => !isBlankRow(r)) : rows;
    useEffect(() => {
        if (!isPayRec) return;
        if (rows.length === 0 || !isBlankRow(rows[rows.length - 1])) {
            setRows((rs) => [...rs, newRow()]);
        }
    }, [isPayRec, rows]);

    // Was this form opened from ⋮ Duplicate / the reconciliation's "Book it"?
    // Answered DURING RENDER, before any of the start-up effects below run, and
    // read without consuming — the hydration effect itself cannot tell us,
    // because it deletes the stash as it reads it, so on React's second dev
    // pass it looks exactly like an ordinary blank voucher. Anything that fills
    // a field by itself has to stand down when the answer is yes.
    // useState's lazy initialiser, not useRef: a ref's argument is recomputed on
    // every render, and this form re-renders on every keystroke — the peek would
    // be a sessionStorage read plus a JSON.parse each time. This runs once.
    const [openedFromStash] = useState(() => !isEditing && peekDuplicate(kind) != null);

    // Remember the last Cash/Bank ledger used per kind so the daily receipt is
    // just party + amount. Read once the accounts are in (create mode only).
    // Never over a prefill: Book it puts the statement's own bank here, and
    // this used to write the last-used cash ledger straight over it.
    const lastTopKey = `glvoucher:lastTop:${kind}`;
    useEffect(() => {
        if (!isPayRec || isEditing || openedFromStash) return;
        if (topLedgerId != null || accounts.length === 0) return;
        try {
            const saved = Number(window.localStorage.getItem(lastTopKey));
            if (saved && accounts.some((a) => a.id === saved && copy.topFilter(a))) setTopLedgerId(saved);
        } catch { /* storage unavailable — start blank */ }
        // Only on first accounts load; a cleared picker must stay cleared.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accounts.length]);
    const rememberTop = (id: number | null) => {
        if (!isPayRec || id == null) return;
        try { window.localStorage.setItem(lastTopKey, String(id)); } catch { /* ignore */ }
    };

    // Which voucher the bill-wise popup is linking, and on which party ledger.
    // Both are captured together because the form resets itself after a save, and
    // the popup opened right after posting must keep the party it was posted for.
    const [linkTarget, setLinkTarget] = useState<{ voucherId: number; accountId: number; plan?: BillPicks } | null>(null);

    // Bill-wise ticks made in the side panel before save. Kept with the party
    // they belong to, so a change of party simply starts from no ticks; handed
    // to the link popup after posting so it opens ticked the same way.
    const [billPickState, setBillPickState] = useState<{ partyId: number; picks: BillPicks }>({ partyId: 0, picks: {} });

    const accountById = new Map<number, GlAccount>(accounts.map((a) => [a.id, a]));
    const topAccounts = accounts.filter(copy.topFilter);
    // Sales/Purchase Accounts groups carry inventory-linked trading ledgers
    // (Sales A/c, Purchase A/c, and their Returns) — those belong on
    // sale/purchase vouchers, not a plain expense/income Payment or Receipt.
    const rowAccounts = accounts
        .filter(copy.rowFilter)
        .filter((a) => !isPayRec || !incomeExpOnly ||
            (a.group?.type === rowNatureType &&
                a.group?.name !== ACCOUNT_GROUPS.SALES_ACCOUNTS &&
                a.group?.name !== ACCOUNT_GROUPS.PURCHASE_ACCOUNTS));
    const topAccount  = effectiveTopAccountId ? accountById.get(effectiveTopAccountId) : undefined;

    // The party ledger this voucher stands against — stamped on the spine so
    // reports and the bill-wise popup can find the voucher by party.
    //
    // A Credit/Debit Note carries the party on top. A Receipt or Payment carries
    // it in the particulars ("Received from" / "Paid to"), where there may be
    // none, one, or several: a scalar column can only hold the single-party case,
    // so several parties leaves it null. Nothing is lost by that — bill-wise
    // linking reads the GL legs, which name every party on the voucher.
    const isPartyAccount = (a?: GlAccount) => !!a && (isSundryDebtor(a) || isSundryCreditor(a));
    const partyRowIds = [...new Set(
        activeRows.map((r) => r.accountId)
            .filter((id): id is number => id !== null && isPartyAccount(accountById.get(id))),
    )];
    const partyLedgerId: number | null = copy.topPickerKind === "party"
        ? effectiveTopAccountId
        : partyRowIds.length === 1 ? partyRowIds[0] : null;

    // "Bank-like" = Bank Accounts or Bank OD A/c — both are a real cash/cheque
    // movement at the counter, so depositing into either behaves the same way.
    const isBankLikeAcct = (a?: GlAccount) => isBankLikeGroupName(a?.group?.name);
    const topIsBank  = isContra && isBankLikeAcct(topAccount);
    const isCashAcct = (a?: GlAccount) => a?.group?.name === ACCOUNT_GROUPS.CASH_IN_HAND;
    // Cash "Transfer from" rows — each gets its own side panel while capture is on.
    const cashRows = isContra && denomOn
        ? rows.filter((r) => isCashAcct(r.accountId ? accountById.get(r.accountId) : undefined))
        : [];
    const showDenomPanels = cashRows.length > 0;
    // Payment in cash to ONE party / staff ledger → the cash is deposited into
    // their own bank. Same rule as the print (partyDepositSlip.ts): Paid from is
    // Cash-in-Hand and every non-negative row is that one ledger. With an A/C No
    // on file it prints the Bank Deposit Slip, so the note count is offered;
    // without one it prints the normal voucher and the form says why.
    const payeeIds = isPayment && isCashAcct(topAccount)
        ? [...new Set(activeRows.filter((r) => r.accountId != null && parseRowAmount(r.amount) >= 0).map((r) => r.accountId!))]
        : [];
    const depositPayee = payeeIds.length === 1 ? accountById.get(payeeIds[0]) : undefined;
    const partyDeposit = depositPayee?.partyBank === true;
    const showPayDenom = partyDeposit && denomOn;
    // Count ticked → the payee's row amount IS the count (locked, like a Contra
    // cash row), net of any other row, so the cash paid equals the notes counted.
    const payeeRow = partyDeposit ? activeRows.find((r) => r.accountId === depositPayee?.id) : undefined;
    const payLockedRow = showPayDenom ? payeeRow : undefined;
    const lockPayeeAmount = (d: RowDenom) => {
        if (!payeeRow) return;
        const others = activeRows.filter((r) => r.id !== payeeRow.id).reduce((s, r) => s + parseRowAmount(r.amount), 0);
        const amt = round2(rowDenomTotal(d) - others);
        updateRow(payeeRow.id, { amount: amt > 0 ? String(amt) : "" });
    };
    // Payment / Receipt with ONE party row → its open bills sit beside the form
    // from the moment the party is picked (read-only; the link itself happens in
    // the popup after posting). A Receipt settles receivables, a Payment payables.
    const showOpenBills = isPayRec && !isEditing && partyLedgerId != null;
    const openBillsSide: 1 | -1 = kind === "RECEIPT" ? 1 : -1;
    const showSidePanel = showDenomPanels || showOpenBills || showPayDenom;
    const partyRow = partyLedgerId != null ? rows.find((r) => r.accountId === partyLedgerId) : undefined;
    const billPicks: BillPicks = billPickState.partyId === partyLedgerId ? billPickState.picks : {};
    // The amount was typed below what the ticks place → drop ticks, last first,
    // until they fit (a tick can never claim money the row does not have).
    const trimPicksTo = (amt: number) => {
        const entries = Object.entries(billPicks);
        let total = entries.reduce((s, [, v]) => s + v, 0);
        if (total <= amt + 0.005) return;
        const next: BillPicks = { ...billPicks };
        for (let i = entries.length - 1; i >= 0 && total > amt + 0.005; i--) {
            const [id, v] = entries[i];
            const keep = Math.max(0, round2(v - (total - amt)));
            total = round2(total - v + keep);
            if (keep > 0.005) next[Number(id)] = keep; else delete next[Number(id)];
        }
        setBillPickState({ partyId: partyLedgerId ?? 0, picks: next });
    };
    // At least one Transfer-from is cash → this contra moves physical cash, so
    // the denomination option is meaningful (deposit to bank, or cash handover).
    // A bank → cash withdrawal has no cash source and doesn't offer it.
    const hasCashSource = isContra && rows.some((r) => isCashAcct(r.accountId ? accountById.get(r.accountId) : undefined));
    const showDenomToggle = topIsBank || hasCashSource || partyDeposit;

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

    const rowsTotal = activeRows.reduce((s, r) => s + parseRowAmount(r.amount), 0);
    const topTotal  = rowsTotal;  // top side auto-derives from particulars sum
    // Payment count ticked → the notes must add up to the cash paid (the slip
    // prints the count, so a mismatch would send the bank the wrong sum).
    const payDenomMatches = !showPayDenom || Math.abs(rowDenomTotal(payDenom) - rowsTotal) < 0.005;
    const balanced  = rowsTotal > 0
        && activeRows.every((r) => r.accountId !== null && (allowNegativeRows ? parseRowAmount(r.amount) !== 0 : parseRowAmount(r.amount) > 0))
        && !!effectiveTopAccountId
        // top account can't equal any particulars account (would self-balance)
        && activeRows.every((r) => r.accountId !== effectiveTopAccountId)
        && chequesComplete
        && payDenomMatches;

    // Org's note/coin list for the denomination panels (same as shift close).
    useEffect(() => {
        if (!isContra && !isPayment) return;
        getOrgDefaults()
            .then((od) => setDenomList(od.cashDenominationsJson?.length ? od.cashDenominationsJson : FALLBACK_DENOMS))
            .catch(() => setDenomList(FALLBACK_DENOMS));
    }, [isContra, isPayment]);

    // Transfer-to is a bank → denomination capture auto-ticks (user can untick);
    // switching the destination off a bank unticks it again. A Payment the same
    // way, the moment it becomes a cash deposit into the party's bank.
    useEffect(() => {
        if (isContra) setDenomOn(topIsBank);
    }, [isContra, topIsBank]);
    useEffect(() => {
        if (isPayment) setDenomOn(partyDeposit && (!isEditing || payDenomSavedRef.current));
    }, [isPayment, partyDeposit, isEditing]);

    useEffect(() => {
        // Skip the next-ref fetch in edit mode — we'll show the loaded reference.
        if (!isEditing) {
            axios.get<{ reference: string }>(`/api/accountancy/vouchers/next-ref?type=${kind}`)
                .then((r) => setNextRef(r.data.reference))
                .catch(() => setNextRef(""));
        }
    }, [kind, isEditing]);

    // ── Party preload (Quick Actions from an open customer profile) ─────────
    useEffect(() => {
        if (isEditing || !initialParty) return;
        if (copy.topPickerKind === "party") {
            setTopParty(initialParty);
        } else if (isPayRec && initialParty.accountId != null) {
            setRows([{ ...newRow(), accountId: initialParty.accountId }, newRow()]);
            focusRowAmount(0);
        }
        // Once, on mount — the party is a starting value, not a binding.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Settle-a-bill preload (the link popup sends the user here) ─────────
    // Opened as /vouchers/receipts/new?partyAccountId=..&amount=..&billId=..
    // the form starts as the bill left it: the party in the first particulars
    // row, the open amount typed, and that bill already ticked in the open-bills
    // panel beside the form. Everything else — which cash or bank account, the
    // date, a part payment — stays the user's to change, because this is the
    // real voucher screen and not a shortcut around it.
    //
    // Hosted in a dialog there is no route to read, so the same three values
    // arrive as `settleBill`; on the /new page they are read straight off the
    // URL rather than through useSearchParams, being a one-shot start value.
    useEffect(() => {
        if (isEditing || !isPayRec) return;
        const qs = new URLSearchParams(window.location.search);
        const partyAccountId = settleBill ? settleBill.partyAccountId : Number(qs.get("partyAccountId"));
        if (!Number.isFinite(partyAccountId) || partyAccountId <= 0) return;
        const amount = settleBill ? settleBill.amount : Number(qs.get("amount"));
        const billId = settleBill ? settleBill.billId : Number(qs.get("billId"));
        const typed  = Number.isFinite(amount) && amount > 0 ? String(round2(amount)) : "";
        setRows([{ ...newRow(), accountId: partyAccountId, amount: typed }, newRow()]);
        if (Number.isFinite(billId) && billId > 0 && typed) {
            setBillPickState({ partyId: partyAccountId, picks: { [billId]: round2(amount) } });
        }
        focusRowAmount(0);
        // Once, on mount — the bill is a starting value, not a binding.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
        const sourceLines = dup.lines as { accountId?: number | null; type?: "DEBIT" | "CREDIT"; amount?: number | string; description?: string | null; method?: string | null; reference?: string | null }[];
        // Extra topSide lines beyond the first are negative particulars rows
        // (e.g. an MDR deduction) that flipped onto the top account's side on
        // save — fold them back in as negative rows.
        const topSideLines = sourceLines.filter((l) => l.type === copy.topSide && l.accountId != null);
        const topLine      = topSideLines[0];
        const extraTopLines = topSideLines.slice(1);
        const rowLines   = sourceLines.filter((l) => l.type === copy.rowSide);
        if (topLine?.accountId != null) setTopLedgerId(topLine.accountId);
        const mergedRows = [
            ...rowLines.map((l) => ({ accountId: l.accountId ?? null, amount: l.amount, note: l.description ?? "", method: l.method, reference: l.reference })),
            ...extraTopLines.map((l) => ({ accountId: l.accountId ?? null, amount: l.amount != null ? -Number(l.amount) : null, note: l.description ?? "", method: l.method, reference: l.reference })),
        ];
        if (mergedRows.length > 0) {
            setRows(mergedRows.map((l): Row => ({
                id:        ++rowSeq,
                accountId: l.accountId ?? null,
                amount:    l.amount != null ? String(Number(l.amount)) : "",
                note:      l.note,
                method:    (l.method as PaymentInstrument | null | undefined) ?? "",
                reference: l.reference ?? "",
            })));
        }
        // A producer that is not the Duplicate menu (the bank reconciliation's
        // "Book it") says what it did in its own words.
        const customToast = typeof dup.extras?.toast === "string" ? dup.extras.toast : null;
        toast.success(customToast ?? "Duplicated — review and Save to create a new voucher");
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
                // Any EXTRA topSide lines (Payment/Receipt only) are negative
                // particulars rows (e.g. an MDR deduction) that flipped onto the
                // top account's side on save — fold them back in as negative rows.
                const topSideLines = v.lines.filter((l) => l.type === copy.topSide);
                const topLine = topSideLines[0];
                const extraTopLines = topSideLines.slice(1);
                const rowLines = v.lines.filter((l) => l.type === copy.rowSide);

                if (topLine) setTopLedgerId(topLine.accountId);
                const combinedRows = [
                    ...rowLines.map((l) => ({ accountId: l.accountId, amount: Number(l.amount), note: l.description ?? "", method: l.method, reference: l.reference })),
                    ...extraTopLines.map((l) => ({ accountId: l.accountId, amount: -Number(l.amount), note: l.description ?? "", method: l.method, reference: l.reference })),
                ];
                const mappedRows: Row[] = combinedRows.length > 0
                    ? combinedRows.map((l) => ({
                        id:        ++rowSeq,
                        accountId: l.accountId,
                        amount:    String(l.amount),
                        note:      l.note,
                        method:    (l.method as PaymentInstrument | null | undefined) ?? "",
                        reference: l.reference ?? "",
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
                } else if (kind === "PAYMENT") {
                    // Payment into a party's bank: the one count comes back as is.
                    const saved = parseDenomJson(v.denomJson);
                    payDenomSavedRef.current = saved != null;
                    if (saved) {
                        setDenomOn(true);
                        setPayDenom({ counts: Object.fromEntries(Object.entries(saved.notes).map(([k, c]) => [k, String(c)])) });
                    }
                }

                // Snapshot original for dirty-check
                originalSnapshotRef.current = {
                    date:       v.date.slice(0, 10),
                    narration:  (v.narration ?? "").trim(),
                    denom:      denomKey(parseDenomJson(v.denomJson)),
                    lines:      normalizeLines(v.lines.map((l) => ({
                        accountId:   l.accountId,
                        type:        l.type,
                        amount:      Number(l.amount),
                        description: l.description,
                        method:      l.method,
                        reference:   l.reference,
                    }))),
                };
            })
            .catch(() => toast.error("Failed to load voucher"))
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isEditing, voucherId, kind, isPayRec, copy.topSide, copy.rowSide, reloadCounter]);

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
        // Payment: the amount follows the count once there is one — ticking with
        // nothing counted keeps an amount already there as the target to count to.
        if (on && isPayment && rowDenomTotal(payDenom) > 0) lockPayeeAmount(payDenom);
        if (on && isContra) {
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
        // Payment: notes only, and only while it is a party deposit with the
        // box ticked — anything else clears a stale count.
        if (isPayment) {
            if (!showPayDenom) return null;
            const notes: Record<string, number> = {};
            for (const [den, c] of Object.entries(payDenom.counts)) {
                const cnt = parseInt(c || "0", 10) || 0;
                if (cnt > 0) notes[den] = cnt;
            }
            return Object.keys(notes).length ? { notes, cheques: [] } : null;
        }
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

    // Print after save per the Thermal toggle — silent thermal print (like POS),
    // else the format-selection page. See printVoucherAfterSave.
    const openReceipt = (id: number) =>
        void printVoucherAfterSave("gl", id, { thermal });

    const submit = async (postAfterSave: boolean, print = false) => {
        if (!chequesComplete) {
            toast.error("Enter the cheque number for each bank Transfer-from row.");
            return;
        }
        if (!payDenomMatches) {
            toast.error(`The notes counted (₹ ${fmt(rowDenomTotal(payDenom))}) don't match the payment (₹ ${fmt(rowsTotal)}). Fix the count, or untick Denomination details.`);
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
        const rowLines = activeRows.map((r) => {
            const amt = parseRowAmount(r.amount);
            const negative = allowNegativeRows && amt < 0;
            return {
                accountId:   r.accountId!,
                // A negative row (e.g. MDR charge) posts on the TOP account's
                // side instead — it's a deduction, not a same-side particular.
                type:        negative ? copy.topSide : copy.rowSide,
                amount:      Math.abs(amt),
                description: r.note.trim() || undefined,
                ...(isPayRec && r.method ? { method: r.method } : {}),
                ...(isPayRec && (r.reference ?? "").trim() ? { reference: r.reference!.trim() } : {}),
            };
        });
        const allLines = [topLine, ...rowLines];

        // ── Edit mode: dirty-check then PATCH ───────────────────────────────
        if (isEditing && voucherId != null) {
            const current: Snapshot = {
                date,
                narration:  narration.trim(),
                denom:      denomKey(buildDenomPayload()),
                lines:      normalizeLines(allLines),
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
                    ...(partyLedgerId != null ? { partyAccountId: partyLedgerId } : {}),
                    lines:     allLines,
                    // Contra / Payment: null clears a stale capture when the box is unticked.
                    ...(isContra || isPayment ? { denomJson: buildDenomPayload() } : {}),
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
            // ONE request: create, and post in the same transaction when asked.
            // It used to be create-then-POST-[id]/post — two round trips for what
            // the user sees as a single action, with the voucher sitting as a
            // DRAFT in between. `reference` is null on a draft: the number is
            // taken when the voucher posts, so a draft shows as UV-<id>.
            const created = await axios.post<{ id: number; reference: string | null }>(
                "/api/accountancy/vouchers",
                {
                    type:      kind,
                    date,
                    narration: narration.trim() || undefined,
                    ...(partyLedgerId != null ? { partyAccountId: partyLedgerId } : {}),
                    lines:     allLines,
                    ...(isContra || isPayment ? { denomJson: buildDenomPayload() } : {}),
                    ...(postAfterSave ? { post: true } : {}),
                },
            );
            const shownNo = created.data.reference ?? `UV-${created.data.id}`;
            if (postAfterSave) {
                clearOpenBillsCache();   // the party's dues just moved
                toast.success(`${copy.title} ${shownNo} saved & posted`);
                // Now it is posted, so it can legally settle a bill. The panel
                // has already said which — including any credit the party had
                // lying with us, and an opening balance that still needs making
                // into a bill — so carry it out rather than asking again. A
                // failure here leaves the voucher posted and unlinked, which is a
                // state the "Link to bills" button can finish by hand.
                if (partyLedgerId != null && Object.keys(billPicks).length > 0) {
                    try {
                        const done = await settleFromPicks({
                            accountId: partyLedgerId,
                            voucherId: created.data.id,
                            side:      openBillsSide,
                            picks:     billPicks,
                            // Counted payment: ticks could run ahead of the count
                            // while notes were being counted — link no more than
                            // was actually paid (the settle step knows a bill from
                            // a credit; the form does not).
                            ...(payLockedRow && partyRow ? { maxOwn: Math.max(0, parseRowAmount(partyRow.amount)) } : {}),
                        });
                        if (done) {
                            clearOpenBillsCache();
                            clearBillLinkCache();
                            toast.success(
                                done.credits > EPS
                                    ? `Settled ${done.bills} bill(s) — ₹${fmt(done.placed)}, of which ₹${fmt(done.credits)} from credits already with this party.`
                                    : `Settled ${done.bills} bill(s) — ₹${fmt(done.placed)}.`,
                            );
                        }
                    } catch (e) {
                        toast.error(extractApiError(e, "Saved and posted, but the bills could not be settled — use Link to bills."));
                    }
                }
            } else {
                toast.success(`${copy.title} ${shownNo} saved as draft`);
            }
            if (print) openReceipt(created.data.id);
            onSaved?.(created.data.id, postAfterSave);
            // Reset for the next voucher instead of navigating away — same as the
            // Sale form: the user can punch in the next entry without leaving.
            // Cancel / Close X are the explicit exits to the register.
            rememberTop(effectiveTopAccountId);
            setNarration("");
            // Payment / Receipt keep the Cash/Bank ledger for the next entry.
            if (!isPayRec) setTopLedgerId(null);
            setTopParty(null);
            partyPickerRef.current?.clear();
            setRows([newRow()]);
            setBillPickState({ partyId: 0, picks: {} });
            if (isPayRec) focusRowLedger(0);
            setRowDenoms({});
            setPayDenom(emptyRowDenom());
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
        <div ref={rootRef} className="flex flex-col flex-1 min-h-0 bg-background" onChange={() => { isDirtyRef.current = true; }}>
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
                            {/* On a NEW voucher this is a preview, not the number:
                                the series advances when the voucher posts, so a
                                draft saved now carries none, and the figure can
                                move if someone else posts first. */}
                            <label className="text-muted-foreground uppercase tracking-wide" title={isEditing ? undefined : "The number this voucher would take if posted from here now. A draft takes no number until it is posted."}>No.</label>
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
            {/* Entry boxes sit on the raised (white) surface so they stand off the
                grey page, and hint text is faded so it never reads as typed data. */}
            <div ref={bodyRef} className="flex-1 overflow-y-auto px-8 py-6 [&_input]:bg-card [&_select]:bg-card [&_input::placeholder]:text-muted-foreground/55 [&_input:disabled]:bg-muted">
                <div className={`mx-auto flex items-start gap-8 ${showSidePanel ? "max-w-6xl" : "max-w-3xl"}`}>
                <div className="min-w-0 flex-1 space-y-6">

                    {/* Top side — single first line. Dr/Cr prefix in grey, then picker, then amount. */}
                    <div className="space-y-2">
                        <div className={`grid items-start gap-3 pb-2 border-b border-border/60 ${isPayRec ? "grid-cols-1" : "grid-cols-[40px_minmax(0,1fr)_160px]"}`}>
                            {!isPayRec && (
                                <span className="pt-2 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                                    {copy.topSide === "DEBIT" ? "Dr" : "Cr"}
                                </span>
                            )}
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
                                        onChange={(a) => {
                                            setTopLedgerId(a?.id ?? null);
                                            if (isPayRec && a) focusRowLedger(0);
                                        }}
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
                                        {partyDeposit
                                            ? `Denomination details — count the cash going into ${depositPayee?.name ?? "the party"}'s bank; unticked prints a blank pen-fill slip`
                                            : topIsBank
                                            ? "Denomination details — cash amounts locked to the counted total; unticked prints a blank pen-fill slip"
                                            : "Denomination details — count the cash and print a handover slip; unticked keeps a plain voucher"}
                                    </label>
                                )}
                                {/* Cash to a party with no A/C No on file — say why
                                    no deposit slip, and where to fix it. */}
                                {depositPayee?.partyBank === false && (
                                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                                        No bank details saved for {depositPayee.name} — this prints as a normal payment voucher.
                                        Add their A/C No on the Bank tab to print a bank deposit slip.
                                    </p>
                                )}
                            </div>
                            {!isPayRec && (
                                <div className="pt-6 text-right font-mono tabular-nums text-sm">
                                    {topTotal > 0 ? `₹ ${fmt(topTotal)}` : <span className="text-muted-foreground/65">—</span>}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Particulars rows */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between px-1">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{copy.rowsHeader}</p>
                            {isPayRec && (
                                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                                    <Checkbox
                                        checked={incomeExpOnly}
                                        onCheckedChange={(v) => setIncomeExpOnly(v === true)}
                                    />
                                    {kind === "PAYMENT" ? "Income / Expenditure — show only expense ledgers" : "Income / Expenditure — show only income ledgers"}
                                </label>
                            )}
                        </div>
                        <table className="w-full">
                            <thead>
                                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                                    <th className="w-8 px-1 py-1 text-left font-medium">#</th>
                                    <th className="px-2 py-1 text-left font-medium">{isPayRec ? "Particulars" : `${copy.rowSide === "DEBIT" ? "Dr" : "Cr"} · Particulars`}</th>
                                    {isPayRec && SHOW_INSTRUMENT_COLUMNS && <th className="w-24 px-1 py-1 text-left font-medium">By</th>}
                                    {isPayRec && SHOW_INSTRUMENT_COLUMNS && <th className="w-36 px-1 py-1 text-left font-medium">Ref no.</th>}
                                    <th className="w-40 px-2 py-1 text-right font-medium">Amount</th>
                                    <th className="w-8 px-1 py-1" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, i) => {
                                    const acct = row.accountId ? accountById.get(row.accountId) : undefined;
                                    // Capture on + cash source → the amount comes from
                                    // the side panel, plain typing is off.
                                    const denomLocked = (isContra && denomOn && isCashAcct(acct)) || row.id === payLockedRow?.id;
                                    return (
                                        <tr
                                            key={row.id}
                                            data-row-idx={i}
                                            className="border-t border-border/40 align-top"
                                            onFocus={isPayRec ? () => setFocusedRowIdx(i) : undefined}
                                            onBlur={isPayRec ? (e) => {
                                                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusedRowIdx((cur) => (cur === i ? null : cur));
                                            } : undefined}
                                        >
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
                                                        // Ledger picked → straight to its amount (Tally flow).
                                                        if (isPayRec && a) focusRowAmount(i);
                                                    }}
                                                    accounts={rowAccounts}
                                                    placeholder={copy.rowPlaceholder}
                                                    // Thousands of party ledgers: the list waits for a character.
                                                    minChars={isPayRec ? 1 : 0}
                                                />
                                                <BalanceHint account={acct} />
                                                {/* Payment / Receipt: the note box is shown only for the row in
                                                    hand (or one that has a note), so the list stays short. Tab
                                                    walks ledger → By → Ref → amount; the note is reached by mouse
                                                    (or Enter in it goes on to the amount). */}
                                                {(!isPayRec || focusedRowIdx === i || row.note.trim()) && (
                                                    <Input
                                                        value={row.note}
                                                        onChange={(e) => updateRow(row.id, { note: e.target.value })}
                                                        placeholder={SHOW_INSTRUMENT_COLUMNS ? "Note (optional)" : "Note — e.g. UPI ref / cheque no. (optional)"}
                                                        tabIndex={isPayRec ? -1 : undefined}
                                                        onKeyDown={isPayRec ? (e) => { if (e.key === "Enter") { e.preventDefault(); focusRowAmount(i); } } : undefined}
                                                        className="h-7 text-xs mt-1"
                                                    />
                                                )}
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
                                            {isPayRec && SHOW_INSTRUMENT_COLUMNS && (
                                                <td className="px-1 py-2">
                                                    <select
                                                        value={row.method ?? ""}
                                                        onChange={(e) => updateRow(row.id, { method: e.target.value as PaymentInstrument | "" })}
                                                        className="h-8 w-full rounded-md border border-input bg-background px-1 text-xs"
                                                        title="How this party paid (optional)"
                                                    >
                                                        <option value="">—</option>
                                                        {PAYMENT_INSTRUMENTS.map((opt) => (
                                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                            )}
                                            {isPayRec && SHOW_INSTRUMENT_COLUMNS && (
                                                <td className="px-1 py-2">
                                                    <Input
                                                        value={row.reference ?? ""}
                                                        onChange={(e) => updateRow(row.id, { reference: e.target.value })}
                                                        placeholder="Cheque / UPI ref"
                                                        maxLength={60}
                                                        className="h-8 text-xs"
                                                    />
                                                </td>
                                            )}
                                            <td className="px-2 py-2">
                                                <Input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={row.amount}
                                                    placeholder={denomLocked ? "Via denoms →" : "0.00"}
                                                    disabled={denomLocked}
                                                    title={denomLocked ? "Amount follows the denomination panel" : undefined}
                                                    onChange={(e) => {
                                                        if (isRowAmountChars(e.target.value)) {
                                                            updateRow(row.id, { amount: e.target.value });
                                                            if (partyRow?.id === row.id) trimPicksTo(Math.max(0, parseRowAmount(e.target.value)));
                                                        }
                                                    }}
                                                    data-amount=""
                                                    // Enter on the amount → next row's ledger (a blank one
                                                    // is always waiting); on an empty last row → Narration.
                                                    onKeyDown={isPayRec ? (e) => {
                                                        if (e.key !== "Enter") return;
                                                        e.preventDefault();
                                                        if (i + 1 < rows.length) focusRowLedger(i + 1);
                                                        else narrationRef.current?.focus();
                                                    } : undefined}
                                                    className="h-8 text-right tabular-nums font-mono"
                                                />
                                            </td>
                                            <td className="px-1 py-2 text-center">
                                                {rows.length > 1 && !(isPayRec && isBlankRow(row)) && (
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
                        {!isPayRec && (
                            <div className="px-1 pt-2">
                                <Button variant="ghost" size="sm" onClick={addRow} className="h-auto py-1 text-xs text-primary">
                                    <Plus size={12} className="mr-1" /> Add Row
                                </Button>
                            </div>
                        )}
                        {/* Payment / Receipt: one plain total instead of the Dr/Cr balance card —
                            the money side always equals the particulars, so there is nothing to match. */}
                        {isPayRec && (
                            <div className="flex items-baseline justify-end gap-3 border-t border-border px-2 pt-2">
                                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                                    Total {kind === "RECEIPT" ? "received" : "paid"}
                                </span>
                                <span className="font-mono tabular-nums text-base font-semibold">
                                    ₹ {fmt(rowsTotal)}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Totals strip — Contra / Credit Note / Debit Note keep the Dr·Cr check */}
                    {!isPayRec && (
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
                    )}

                    {/* Narration + amount-in-words — Tally convention */}
                    <div className="space-y-1">
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Narration</label>
                        <Input
                            ref={narrationRef}
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

                {/* Denomination panels — one per cash Transfer-from row (Contra)
                    or one for the cash paid (Payment into a party's bank); the
                    combined result is what the deposit slip prints. */}
                {showSidePanel && (
                    <aside
                        className={`${showOpenBills ? "w-[440px]" : "w-[300px]"} shrink-0 space-y-4 sticky top-0 overflow-y-auto`}
                        // Visible body height minus its py-6 padding (48px).
                        style={bodyHeight ? { maxHeight: Math.max(240, bodyHeight - 48) } : undefined}
                    >
                        {showOpenBills && partyLedgerId != null && (
                            <OpenBillsPanel
                                accountId={partyLedgerId}
                                partyName={accountById.get(partyLedgerId)?.name}
                                side={openBillsSide}
                                amount={partyRow ? Math.max(0, parseRowAmount(partyRow.amount)) : 0}
                                picks={billPicks}
                                onChange={(picks, amt) => {
                                    setBillPickState({ partyId: partyLedgerId, picks });
                                    // A counted amount belongs to the notes, not the ticks.
                                    if (amt !== null && partyRow && partyRow.id !== payLockedRow?.id) updateRow(partyRow.id, { amount: amt > 0 ? String(round2(amt)) : "" });
                                }}
                            />
                        )}
                        {cashRows.map((r) => (
                            <DenomPanel
                                key={r.id}
                                title={`${r.accountId ? (accountById.get(r.accountId)?.name ?? "Cash") : "Cash"} — Denominations`}
                                denomList={denomList}
                                value={rowDenoms[r.id] ?? emptyRowDenom()}
                                onChange={(updater) => setRowDenom(r.id, updater)}
                            />
                        ))}
                        {showPayDenom && (
                            <DenomPanel
                                title={`${topAccount?.name ?? "Cash"} — Denominations`}
                                denomList={denomList}
                                value={payDenom}
                                // Deliberately no trimPicksTo here: the count climbs note
                                // by note, and trimming on each step would cut ticks made
                                // first down to the first note. The settle step fits them
                                // to the count at Save (settleFromPicks maxOwn).
                                onChange={(updater) => {
                                    const next = updater(payDenom);
                                    setPayDenom(next);
                                    lockPayeeAmount(next);
                                    isDirtyRef.current = true;
                                }}
                                target={rowsTotal}
                            />
                        )}
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
                        {loadedVoucher.status === "POSTED" && !loadedVoucher.deletedAt && !loadedVoucher.cancelledAt && partyLedgerId != null && voucherId != null && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setLinkTarget({ voucherId, accountId: partyLedgerId })}
                                className="gap-1.5 text-muted-foreground hover:text-foreground"
                                title="Link this voucher to the party's open bills"
                            >
                                <Link2 size={14} /> Link to bills
                            </Button>
                        )}
                        {loadedVoucher.status === "POSTED" && !loadedVoucher.deletedAt && !loadedVoucher.cancelledAt && (
                            <span className="text-[11px] text-amber-600 italic">
                                Will reverse + re-post on save (reference preserved)
                            </span>
                        )}
                    </div>
                ) : undefined}
            />
            {linkTarget && (
                <BillLinkDialog
                    open
                    onOpenChange={(v) => { if (!v) setLinkTarget(null); }}
                    accountId={linkTarget.accountId}
                    voucherId={linkTarget.voucherId}
                    initialPlan={linkTarget.plan}
                    onSaved={() => { clearOpenBillsCache(); setReloadCounter((c) => c + 1); }}
                />
            )}
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

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { CheckCircle2 } from "lucide-react";
import { NumericInput } from "@/shared/components/NumericInput";
import { formatInr, round2 } from "@/shared/lib/format/moneyInr";
import { businessTodayIso, formatDate } from "@/shared/lib/format/formatDate";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { ACCOUNT_GROUPS, PAYMENT_INSTRUMENTS, type PaymentInstrument } from "@/shared/lib/constants/accounting";
import { settleFromPicks } from "@/modules/accountancy/lib/settleFromPicks";
import { autoLinkOrder } from "@/modules/accountancy/lib/billLinkPlan";
import { placeOnBills } from "../lib/moneyPlacement";
import { useActiveBranchStore } from "@/store/activeBranchStore";
import MobileHeader from "./MobileHeader";
import { useMobileResource } from "../hooks/useMobileResource";
import { dropAnswers, mobileKey } from "../lib/mobileCache";
import { forgetPartyBalances } from "../hooks/usePartyBalances";
import { MOBILE_SETUP_FRESH_MS } from "@/shared/lib/constants/polling";
import type { PartyDetail, PaySetup } from "../lib/types";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

export type MoneyKind = "PAYMENT" | "RECEIPT";

const COPY = {
    PAYMENT: { title: "Pay", verb: "Pay", to: "to", ledgerLabel: "Paid from", side: -1 as const, done: "Payment" },
    RECEIPT: { title: "Receive", verb: "Receive", to: "from", ledgerLabel: "Received in", side: 1 as const, done: "Receipt" },
};

/** The modes a phone payment is made by — the office list less "Other". */
const MODES = PAYMENT_INSTRUMENTS.filter((m) => m.value !== "OTHER");

type Saved = { reference: string; settled: { bills: number; placed: number } | null; settleError: string | null };

/** Remembered per person and direction, so the till's usual Cash / bank comes back. */
function readLastLedger(key: string): number | null {
    try {
        const n = Number(localStorage.getItem(key));
        return Number.isInteger(n) && n > 0 ? n : null;
    } catch { return null; }
}

/**
 * Pay a supplier / receive from a customer, from the phone.
 *
 * Saves through the office voucher API — a posted Payment or Receipt, numbered by
 * the same series, gated by the same Role ticks (create + post) — and settles the
 * ticked bills with the office's own `settleFromPicks`, so a phone payment is in
 * every way the one the office Payment screen would have made.
 *
 * The money goes on the bills oldest due first — the order the settling step
 * itself fills them (`autoLinkOrder`), so what the screen shows is what is saved:
 *   • untouched: every bill ticked, the amount is their total;
 *   • an amount typed: the ticks FOLLOW the amount — the oldest bills it covers,
 *     the last one in part ("₹100 of ₹320"); an advance only once every open bill
 *     is full (owner: "the 100 should be adjusted to next bill");
 *   • a tick changed after typing: the hand-picked bills win and the amount
 *     stays; what they cannot take is the advance;
 *   • the amount cleared: back to the ticked bills' total.
 * With no bill ticked at all the server settles the oldest bills itself, as the
 * office does.
 *
 * A supplier with a UPI ID on its Bank tab gets "Open UPI app" with the amount
 * filled in; the money moves in the UPI app, and Save records it here.
 *
 * `expense`: `accountId` is an expense ledger, not a party (quick Pay — rent,
 * electricity, tea): no bills, no UPI, no party on the voucher; the expense is
 * debited and the cash / bank credited, exactly as the office Payment screen
 * posts a payment to an expense head.
 *
 * Opened from quick entry (`back` under the app's /quick), the saved screen offers
 * "New entry" — straight back to the picker, with the cash / bank and mode the
 * next entry remembers.
 */
export default function MobileMoneyForm({ kind, accountId, userId, back, expense = false, pickedBills }: {
    kind: MoneyKind;
    accountId: number;
    userId: string;
    back: string;
    expense?: boolean;
    /** Bills ticked on the party screen — the form starts with only these ticked. */
    pickedBills?: number[];
}) {
    const copy = COPY[kind];
    const quick = back.startsWith(`${PHONE_APP_HOME}/quick`);
    const party = useMobileResource<PartyDetail>(
        expense ? null : `/api/mobile/parties/${accountId}`, `party:${accountId}`, userId, { since: true },
    );
    const setup = useMobileResource<PaySetup>("/api/mobile/pay-setup", "pay-setup", userId, { freshMs: MOBILE_SETUP_FRESH_MS });
    const expenseLedger = expense ? setup.data?.expenseLedgers.find((l) => l.id === accountId) ?? null : null;
    const targetName = expense ? expenseLedger?.name ?? null : party.data?.name ?? null;
    const lastLedgerKey = mobileKey(`last-ledger:${kind}`, userId);

    // Bills this voucher can settle, in the order money is put on them.
    const bills = useMemo(
        () => autoLinkOrder((party.data?.bills ?? [])
            .filter((b) => b.side === copy.side && b.universalVoucherId != null)
            .map((b) => ({ ...b, id: b.universalVoucherId!, universalVoucherId: b.universalVoucherId!, dueDate: b.dueDate ?? b.billDate, open: b.outstanding }))),
        [party.data, copy.side],
    );

    // Ticks chosen by hand (null = every bill); the amount as typed (null = follow
    // the ticks); `handPicked` = a tick was changed AFTER an amount was typed.
    const [ticks, setTicks] = useState<Set<number> | null>(() => (pickedBills?.length ? new Set(pickedBills) : null));
    const [typedAmount, setTypedAmount] = useState<string | null>(null);
    const [handPicked, setHandPicked] = useState(false);
    const [ledgerId, setLedgerId] = useState<number | null>(null);
    const [mode, setMode] = useState<PaymentInstrument | null>(null);
    const [reference, setReference] = useState("");
    const [note, setNote] = useState("");
    const [date, setDate] = useState(() => businessTodayIso());
    const storedBranch = useActiveBranchStore((s) => s.activeBranchId);
    const [step, setStep] = useState<"form" | "confirm" | "saving">("form");
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState<Saved | null>(null);

    const allIds = bills.map((b) => b.id);
    const handTicks = ticks ?? new Set(allIds);
    // An amount typed and no tick changed since: the amount decides the ticks.
    const byAmount = typedAmount != null && !handPicked;
    const pool = byAmount ? new Set(allIds) : handTicks;
    const poolTotal = round2(bills.filter((b) => pool.has(b.id)).reduce((s, b) => s + b.outstanding, 0));
    const amountText = typedAmount ?? (poolTotal > 0 ? String(poolTotal) : "");
    const amount = round2(Number(amountText) || 0);
    const { placed, advance } = placeOnBills(bills, pool, amount);
    const ticked = byAmount ? new Set(placed.keys()) : handTicks;
    const placedBills = bills.filter((b) => placed.has(b.id));
    const unpaidTicked = round2(bills.filter((b) => ticked.has(b.id)).reduce((s, b) => s + b.outstanding - (placed.get(b.id) ?? 0), 0));

    const ledgers = setup.data?.moneyLedgers ?? [];
    const remembered = ledgerId == null && ledgers.length > 0 ? readLastLedger(lastLedgerKey) : null;
    const ledger = ledgers.find((l) => l.id === ledgerId)
        ?? ledgers.find((l) => l.id === remembered)
        ?? ledgers.find((l) => l.group === ACCOUNT_GROUPS.CASH_IN_HAND)
        ?? ledgers[0]
        ?? null;
    const effectiveMode: PaymentInstrument = mode ?? (ledger?.group === ACCOUNT_GROUPS.CASH_IN_HAND ? "CASH" : "MOBILE_PAYMENT");

    const branches = setup.data?.branches ?? [];
    const branchId = branches.some((b) => b.id === storedBranch) ? storedBranch! : setup.data?.defaultBranchId ?? null;
    const branchName = branches.find((b) => b.id === branchId)?.name ?? null;

    const allowed = kind === "PAYMENT" ? setup.data?.canPay : setup.data?.canReceive;
    const upiHref = !expense && kind === "PAYMENT" && party.data?.upiLink && amount > 0
        ? `${party.data.upiLink}&am=${amount.toFixed(2)}${note.trim() ? `&tn=${encodeURIComponent(note.trim())}` : ""}`
        : null;

    const toggle = (id: number) => {
        const next = new Set(ticked);
        if (next.has(id)) next.delete(id); else next.add(id);
        setTicks(next);
        if (typedAmount != null) setHandPicked(true);
    };

    const onAmount = (v: string) => {
        if (v.trim() === "") {
            // Cleared: back to the ticked bills' total.
            setTicks(new Set(ticked));
            setTypedAmount(null);
        } else {
            setTypedAmount(v);
        }
        setHandPicked(false);
    };

    const problem = !ledger ? "No cash or bank ledger to use."
        : !branchId ? "No branch to post in."
            : amount <= 0 ? "Enter the amount."
                : null;

    const fullCount = placedBills.filter((b) => (placed.get(b.id) ?? 0) >= b.outstanding - 0.005).length;
    const partBill = placedBills.find((b) => (placed.get(b.id) ?? 0) < b.outstanding - 0.005);
    const settleNote = expense ? "" : placedBills.length === 0
        ? (bills.length > 0
            ? "No bill ticked — the oldest bills are settled first, as the office does."
            : advance > 0 ? `No open bill — ${formatInr(advance)} stays as advance.` : "")
        : [
            fullCount > 0 ? `Settles ${fullCount} bill${fullCount === 1 ? "" : "s"} in full` : null,
            partBill ? `${formatInr(placed.get(partBill.id)!)} on ${partBill.ref} (part)` : null,
            advance > 0 ? `${formatInr(advance)} stays as advance` : null,
            !byAmount && unpaidTicked > 0.005 && !partBill ? `${formatInr(unpaidTicked)} of the ticked bills stays unpaid` : null,
        ].filter(Boolean).join("; ") + ".";

    async function save() {
        if (!ledger || !branchId || (expense ? !expenseLedger : !party.data) || amount <= 0) return;
        setStep("saving");
        setError(null);
        // The voucher API stamps the branch from this store (stampRequestContext).
        useActiveBranchStore.getState().setActiveBranchId(branchId);
        const partyLine = {
            accountId,
            type: kind === "PAYMENT" ? "DEBIT" : "CREDIT",
            amount,
            method: effectiveMode,
            ...(reference.trim() ? { reference: reference.trim() } : {}),
        };
        const moneyLine = { accountId: ledger.id, type: kind === "PAYMENT" ? "CREDIT" : "DEBIT", amount };
        const settlesTicks = placedBills.length > 0;
        try {
            const { data: created } = await axios.post<{ id: number; reference: string | null }>("/api/accountancy/vouchers", {
                type: kind,
                date,
                narration: note.trim() || undefined,
                // An expense head is not a party — no party on the voucher, no bills.
                ...(expense ? {} : { partyAccountId: accountId }),
                lines: [moneyLine, partyLine],
                post: true,
                ...(settlesTicks ? { autoLink: false } : {}),
            });
            try { localStorage.setItem(lastLedgerKey, String(ledger.id)); } catch { /* best-effort */ }

            let settled: Saved["settled"] = null;
            let settleError: string | null = null;
            if (settlesTicks) {
                try {
                    const done = await settleFromPicks({
                        accountId,
                        voucherId: created.id,
                        side: copy.side,
                        picks: Object.fromEntries(placed),
                        maxOwn: amount,
                    });
                    if (done) settled = { bills: done.bills, placed: done.placed };
                } catch (e) {
                    settleError = extractApiError(e, "Saved, but the bills could not be settled — use Link to bills in the office.");
                }
            }
            // What this voucher moved must not be shown from a saved copy: the party,
            // the receivable / payable lists, the Day Book, the balances held.
            if (!expense) forgetPartyBalances();
            await dropAnswers(...(expense ? [] : [`party:${accountId}:`, "outstanding:"]), "/api/mobile/daybook");
            setSaved({ reference: created.reference ?? `UV-${created.id}`, settled, settleError });
        } catch (e) {
            setError(extractApiError(e, "Could not save."));
            setStep("confirm");
        }
    }

    if (saved) {
        return (
            <>
                <MobileHeader title={copy.done} back={back} />
                <div className="flex flex-col items-center gap-3 p-6 text-center">
                    <CheckCircle2 className="size-12 text-emerald-600" />
                    <p className="text-lg font-semibold">{copy.done} {saved.reference} saved</p>
                    <p className="text-sm text-muted-foreground">
                        {formatInr(amount)} {copy.to} {targetName} · {ledger?.name}
                    </p>
                    {saved.settled && (
                        <p className="text-sm">Settled {saved.settled.bills} bill{saved.settled.bills === 1 ? "" : "s"} — {formatInr(saved.settled.placed)}</p>
                    )}
                    {saved.settleError && <p className="text-sm text-destructive">{saved.settleError}</p>}
                    <Link href={back} className="mt-2 w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground">
                        {quick ? "New entry" : `Back to ${targetName ?? "party"}`}
                    </Link>
                    {quick && (
                        <Link href={PHONE_APP_HOME} className="w-full rounded-lg border py-3 text-sm">Done</Link>
                    )}
                </div>
            </>
        );
    }

    const loading = !setup.data || (!expense && !party.data);

    return (
        <>
            <MobileHeader title={`${copy.title} ${copy.to} ${targetName ?? (expense ? "expense" : "party")}`} back={back} />
            {(party.error || setup.error) && <p className="px-3 pt-2 text-sm text-destructive">{party.error ?? setup.error}</p>}
            {loading ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : expense && !expenseLedger ? (
                <p className="m-4 rounded-lg border p-4 text-sm text-muted-foreground">
                    This ledger is not under Direct or Indirect Expenses, so it cannot be paid from here.
                </p>
            ) : !allowed ? (
                <p className="m-4 rounded-lg border p-4 text-sm text-muted-foreground">
                    Your role cannot {kind === "PAYMENT" ? "make payments" : "take receipts"}. Ask admin for the{" "}
                    {kind === "PAYMENT" ? "Payment" : "Receipt"} create and post ticks.
                </p>
            ) : step === "form" ? (
                <div className="space-y-5 p-3">
                    {bills.length > 0 && (
                        <section>
                            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Bills to settle</p>
                            <ul className="divide-y rounded-lg border">
                                {bills.map((b) => (
                                    <li key={b.key}>
                                        <label className="flex items-center gap-3 px-3 py-2.5">
                                            <input
                                                type="checkbox"
                                                className="size-5"
                                                checked={ticked.has(b.id)}
                                                onChange={() => toggle(b.id)}
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-sm font-medium">{b.ref}</span>
                                                <span className="block text-xs text-muted-foreground">{formatDate(b.billDate)} · {b.daysOverdue} days</span>
                                            </span>
                                            <span className="text-right text-sm font-semibold">
                                                {ticked.has(b.id) && (placed.get(b.id) ?? 0) < b.outstanding - 0.005 ? (
                                                    <>
                                                        {formatInr(placed.get(b.id) ?? 0)}
                                                        <span className="block text-xs font-normal text-muted-foreground">of {formatInr(b.outstanding)} (part)</span>
                                                    </>
                                                ) : formatInr(b.outstanding)}
                                            </span>
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount (₹)</span>
                        <NumericInput
                            mode="decimal"
                            min={0}
                            value={amountText}
                            onValueChange={onAmount}
                            className="h-12 text-lg font-semibold"
                            placeholder="0.00"
                        />
                        <span className="mt-1 block text-xs text-muted-foreground">{settleNote}</span>
                    </label>

                    <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.ledgerLabel}</span>
                        <select
                            value={ledger?.id ?? ""}
                            onChange={(e) => { setLedgerId(Number(e.target.value)); setMode(null); }}
                            className="h-11 w-full rounded-md border bg-background px-3"
                        >
                            {ledgers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                    </label>

                    <div>
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Mode</span>
                        <div className="flex flex-wrap gap-2">
                            {MODES.map((m) => (
                                <button
                                    key={m.value}
                                    type="button"
                                    onClick={() => setMode(m.value)}
                                    className={`rounded-full border px-3 py-1.5 text-sm ${effectiveMode === m.value ? "border-primary bg-primary/10 font-semibold text-primary" : ""}`}
                                >
                                    {m.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {upiHref && (
                        <a
                            href={upiHref}
                            onClick={() => setMode("MOBILE_PAYMENT")}
                            className="block rounded-lg border border-primary py-3 text-center font-medium text-primary active:bg-primary/10"
                        >
                            Open UPI app — {formatInr(amount)}
                        </a>
                    )}

                    {effectiveMode !== "CASH" && (
                        <label className="block">
                            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {effectiveMode === "CHEQUE" ? "Cheque no." : "UTR / reference no."}
                            </span>
                            <input
                                type="text"
                                value={reference}
                                maxLength={60}
                                onChange={(e) => setReference(e.target.value)}
                                className="h-11 w-full rounded-md border bg-background px-3"
                                autoComplete="off"
                            />
                        </label>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Date</span>
                            <input
                                type="date"
                                value={date}
                                max={businessTodayIso()}
                                onChange={(e) => e.target.value && setDate(e.target.value)}
                                className="h-11 w-full rounded-md border bg-background px-2"
                            />
                        </label>
                        <label className="block">
                            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Branch</span>
                            {branches.length > 1 ? (
                                <select
                                    value={branchId ?? ""}
                                    onChange={(e) => useActiveBranchStore.getState().setActiveBranchId(e.target.value)}
                                    className="h-11 w-full rounded-md border bg-background px-2"
                                >
                                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                                </select>
                            ) : (
                                <span className="flex h-11 items-center px-1 text-sm">{branchName ?? "—"}</span>
                            )}
                        </label>
                    </div>

                    <label className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Note (optional)</span>
                        <input
                            type="text"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            className="h-11 w-full rounded-md border bg-background px-3"
                            autoComplete="off"
                        />
                    </label>

                    {problem && <p className="text-sm text-destructive">{problem}</p>}
                    <button
                        type="button"
                        disabled={problem != null}
                        onClick={() => { setError(null); setStep("confirm"); }}
                        className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground disabled:opacity-40"
                    >
                        Next — check and save
                    </button>
                </div>
            ) : (
                <div className="space-y-4 p-4">
                    <div className="space-y-2 rounded-lg border p-4">
                        <p className="text-lg font-semibold">
                            {copy.verb} {formatInr(amount)} {copy.to} {targetName}
                        </p>
                        <p className="text-sm">
                            {copy.ledgerLabel} <b>{ledger!.name}</b> · {MODES.find((m) => m.value === effectiveMode)?.label}
                            {reference.trim() ? ` (${reference.trim()})` : ""}
                        </p>
                        <p className="text-sm">{formatDate(date)} · {branchName}</p>
                        <p className="text-sm text-muted-foreground">{settleNote}</p>
                        {placedBills.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                                {placedBills.map((b) => `${b.ref} ${formatInr(placed.get(b.id)!)}${placed.get(b.id)! < b.outstanding - 0.005 ? " (part)" : ""}`).join(", ")}
                            </p>
                        )}
                        {note.trim() && <p className="text-sm text-muted-foreground">“{note.trim()}”</p>}
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <button
                        type="button"
                        disabled={step === "saving"}
                        onClick={() => void save()}
                        className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground disabled:opacity-60"
                    >
                        {step === "saving" ? "Saving…" : `Save ${copy.done.toLowerCase()}`}
                    </button>
                    <button
                        type="button"
                        disabled={step === "saving"}
                        onClick={() => setStep("form")}
                        className="w-full rounded-lg border py-3 text-sm disabled:opacity-60"
                    >
                        Back — change something
                    </button>
                </div>
            )}
        </>
    );
}

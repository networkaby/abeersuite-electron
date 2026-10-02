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
import { useActiveBranchStore } from "@/store/activeBranchStore";
import MobileHeader from "./MobileHeader";
import { useMobileResource } from "./useMobileResource";
import { mobileKey } from "./mobileCache";
import type { PartyDetail, PaySetup } from "./types";

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
 * Bills on the side being settled start ticked (oldest first) and the amount
 * follows them until typed over. Paying more than the ticked bills leaves the rest
 * as an advance; less settles the oldest ticked bills first. With no bill ticked
 * the server settles the oldest bills itself, as the office does.
 *
 * A supplier with a UPI ID on its Bank tab gets "Open UPI app" with the amount
 * filled in; the money moves in the UPI app, and Save records it here.
 */
export default function MobileMoneyForm({ kind, accountId, userId, back }: {
    kind: MoneyKind;
    accountId: number;
    userId: string;
    back: string;
}) {
    const copy = COPY[kind];
    const party = useMobileResource<PartyDetail>(`/api/mobile/parties/${accountId}`, `party:${accountId}`, userId);
    const setup = useMobileResource<PaySetup>("/api/mobile/pay-setup", "pay-setup", userId);
    const lastLedgerKey = mobileKey(`last-ledger:${kind}`, userId);

    // Bills this voucher can settle, oldest first.
    const bills = useMemo(
        () => (party.data?.bills ?? [])
            .filter((b) => b.side === copy.side && b.universalVoucherId != null)
            .sort((a, b) => b.daysOverdue - a.daysOverdue),
        [party.data, copy.side],
    );

    // null = untouched: every bill ticked, the amount follows the ticks.
    const [ticks, setTicks] = useState<Set<number> | null>(null);
    const [typedAmount, setTypedAmount] = useState<string | null>(null);
    const [ledgerId, setLedgerId] = useState<number | null>(null);
    const [mode, setMode] = useState<PaymentInstrument | null>(null);
    const [reference, setReference] = useState("");
    const [note, setNote] = useState("");
    const [date, setDate] = useState(() => businessTodayIso());
    const storedBranch = useActiveBranchStore((s) => s.activeBranchId);
    const [step, setStep] = useState<"form" | "confirm" | "saving">("form");
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState<Saved | null>(null);

    const ticked = ticks ?? new Set(bills.map((b) => b.universalVoucherId!));
    const tickedBills = bills.filter((b) => ticked.has(b.universalVoucherId!));
    const tickedTotal = round2(tickedBills.reduce((s, b) => s + b.outstanding, 0));
    const amountText = typedAmount ?? (tickedTotal > 0 ? String(tickedTotal) : "");
    const amount = round2(Number(amountText) || 0);

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
    const upiHref = kind === "PAYMENT" && party.data?.upiLink && amount > 0
        ? `${party.data.upiLink}&am=${amount.toFixed(2)}${note.trim() ? `&tn=${encodeURIComponent(note.trim())}` : ""}`
        : null;

    const toggle = (id: number) => {
        const next = new Set(ticked);
        if (next.has(id)) next.delete(id); else next.add(id);
        setTicks(next);
    };

    const problem = !ledger ? "No cash or bank ledger to use."
        : !branchId ? "No branch to post in."
            : amount <= 0 ? "Enter the amount."
                : null;

    const settleNote = tickedBills.length === 0
        ? "No bill ticked — the oldest bills are settled first, as the office does."
        : amount > tickedTotal + 0.005
            ? `Settles ${tickedBills.length} bill${tickedBills.length === 1 ? "" : "s"}; ${formatInr(amount - tickedTotal)} stays as advance.`
            : amount < tickedTotal - 0.005
                ? `Settles the oldest ticked bills first; ${formatInr(tickedTotal - amount)} of them stays unpaid.`
                : `Settles ${tickedBills.length} bill${tickedBills.length === 1 ? "" : "s"} in full.`;

    async function save() {
        if (!ledger || !branchId || !party.data || amount <= 0) return;
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
        const settlesTicks = tickedBills.length > 0;
        try {
            const { data: created } = await axios.post<{ id: number; reference: string | null }>("/api/accountancy/vouchers", {
                type: kind,
                date,
                narration: note.trim() || undefined,
                partyAccountId: accountId,
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
                        picks: Object.fromEntries(tickedBills.map((b) => [b.universalVoucherId!, b.outstanding])),
                        maxOwn: amount,
                    });
                    if (done) settled = { bills: done.bills, placed: done.placed };
                } catch (e) {
                    settleError = extractApiError(e, "Saved, but the bills could not be settled — use Link to bills in the office.");
                }
            }
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
                        {formatInr(amount)} {copy.to} {party.data?.name} · {ledger?.name}
                    </p>
                    {saved.settled && (
                        <p className="text-sm">Settled {saved.settled.bills} bill{saved.settled.bills === 1 ? "" : "s"} — {formatInr(saved.settled.placed)}</p>
                    )}
                    {saved.settleError && <p className="text-sm text-destructive">{saved.settleError}</p>}
                    <Link href={back} className="mt-2 w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground">
                        Back to {party.data?.name ?? "party"}
                    </Link>
                </div>
            </>
        );
    }

    const loading = !party.data || !setup.data;

    return (
        <>
            <MobileHeader title={`${copy.title} ${copy.to} ${party.data?.name ?? "party"}`} back={back} />
            {(party.error || setup.error) && <p className="px-3 pt-2 text-sm text-destructive">{party.error ?? setup.error}</p>}
            {loading ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
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
                                                checked={ticked.has(b.universalVoucherId!)}
                                                onChange={() => toggle(b.universalVoucherId!)}
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-sm font-medium">{b.ref}</span>
                                                <span className="block text-xs text-muted-foreground">{formatDate(b.billDate)} · {b.daysOverdue} days</span>
                                            </span>
                                            <span className="text-sm font-semibold">{formatInr(b.outstanding)}</span>
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
                            onValueChange={setTypedAmount}
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
                            {copy.verb} {formatInr(amount)} {copy.to} {party.data!.name}
                        </p>
                        <p className="text-sm">
                            {copy.ledgerLabel} <b>{ledger!.name}</b> · {MODES.find((m) => m.value === effectiveMode)?.label}
                            {reference.trim() ? ` (${reference.trim()})` : ""}
                        </p>
                        <p className="text-sm">{formatDate(date)} · {branchName}</p>
                        <p className="text-sm text-muted-foreground">{settleNote}</p>
                        {tickedBills.length > 0 && (
                            <p className="text-xs text-muted-foreground">{tickedBills.map((b) => b.ref).join(", ")}</p>
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

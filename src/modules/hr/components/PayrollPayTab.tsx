"use client";

// HR & People → Payroll → Pay. Settling what the runs accrued.
//
// The list is read off each person's SALARY LEDGER, not off the payroll runs,
// and that is deliberate: the ledger has already netted any advance against the
// accrual, so somebody who took ₹5,000 in hand on the 10th shows ₹11,000 owed
// rather than ₹16,000. Working from the run would pay them twice.
//
// Paying writes ONE Payment voucher with a debit line per person and a single
// credit to the bank or cash it left — one withdrawal is one entry in the bank
// book. No salary expense is touched; that was taken when the run was posted.

import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, HandCoins, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field } from "@/shared/components/Field";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { useApiResource, useGlAccounts } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { confirmAction } from "@/shared/lib/ui/confirmStore";
import { formatDate, todayIso } from "@/shared/lib/format/formatDate";
import { formatInr, formatRupeesFromPaise, parseRupeesToPaise, rupeesToPaise } from "@/shared/lib/format/moneyInr";
import type { PayableStaffDto } from "../lib/payrollTypes";

/** Cash and bank ledgers — the only places salary can leave from. */
const MONEY_GROUPS = ["Cash-in-Hand", "Bank Accounts", "Bank OD A/c", "Payment Gateway"];

export default function PayrollPayTab({ canPay, onPaid }: {
    canPay: boolean;
    onPaid: () => void;
}) {
    const { data, refreshing, error, reload } = useApiResource<PayableStaffDto[]>("/api/hr/payroll/payable");
    const { accounts } = useGlAccounts();

    const [sourceId, setSourceId] = useState<number | null>(null);
    const [date, setDate] = useState(todayIso());
    const [note, setNote] = useState("");
    const [q, setQ] = useState("");
    const [saving, setSaving] = useState(false);
    /** userId → the amount typed, in rupees. Absent means "pay the full balance". */
    const [amounts, setAmounts] = useState<Record<number, string>>({});
    const [picked, setPicked] = useState<Set<number>>(new Set());

    const owed = useMemo(() => (data ?? []).filter((r) => r.balance > 0), [data]);
    const advances = useMemo(() => (data ?? []).filter((r) => r.balance < 0), [data]);

    const rows = useMemo(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) return owed;
        return owed.filter((r) => `${r.name} ${r.staffCode ?? ""}`.toLowerCase().includes(needle));
    }, [owed, q]);

    const sourceOptions = useMemo(
        () => accounts
            .filter((a) => a.group?.name && MONEY_GROUPS.includes(a.group.name))
            .map((a) => ({ value: a.id, label: `${a.name} — ${a.group!.name}`, leaf: a.name, searchText: a.name })),
        [accounts],
    );

    /** What this person will actually be paid, in paise. */
    const amountPaiseOf = (r: PayableStaffDto): number => {
        const typed = amounts[r.userId];
        if (typed === undefined || typed.trim() === "") return rupeesToPaise(r.balance);
        return parseRupeesToPaise(typed) ?? 0;
    };

    const chosen = rows.filter((r) => picked.has(r.userId));
    const totalPaise = chosen.reduce((s, r) => s + amountPaiseOf(r), 0);
    const badAmount = chosen.some((r) => amountPaiseOf(r) <= 0);

    const toggle = (userId: number) => setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(userId)) next.delete(userId); else next.add(userId);
        return next;
    });

    const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.userId));
    const toggleAll = () => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.userId)));

    const pay = async () => {
        if (!sourceId || !chosen.length) return;
        const source = sourceOptions.find((o) => o.value === sourceId);
        const ok = await confirmAction({
            title: `Pay ${formatRupeesFromPaise(totalPaise)} to ${chosen.length} staff?`,
            body: `One Payment voucher dated ${formatDate(date)}: each person's salary ledger debited, and ${source?.leaf ?? "the account"} credited with the whole ${formatRupeesFromPaise(totalPaise)}.`,
            confirmLabel: "Pay them",
        });
        if (!ok) return;

        setSaving(true);
        try {
            const res = await axios.post("/api/hr/payroll/pay", {
                sourceAccountId: sourceId,
                date,
                note: note.trim() || undefined,
                lines: chosen.map((r) => ({ userId: r.userId, amountPaise: amountPaiseOf(r) })),
            });
            toast.success(`Paid ${res.data.headcount} staff — ${res.data.voucherRef ?? "posted"}`);
            setPicked(new Set());
            setAmounts({});
            setNote("");
            reload();
            onPaid();
        } catch (e) {
            toast.error(extractApiError(e, "Could not pay"));
        } finally {
            setSaving(false);
        }
    };

    const totalOwed = owed.reduce((s, r) => s + r.balance, 0);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
                <Field label="Paid from">
                    {() => (
                        <SearchableSelect
                            value={sourceId}
                            options={sourceOptions}
                            onChange={setSourceId}
                            placeholder="Cash or bank"
                            ariaLabel="Paid from"
                            triggerClassName="h-9 w-60 text-sm"
                        />
                    )}
                </Field>
                <Field label="Date">
                    {(id) => <TallyDateInput id={id} value={date} onValueChange={setDate} className="h-9 w-36 text-sm" />}
                </Field>
                <Field label="Note">
                    {(id) => (
                        <Input
                            id={id}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Optional — appears on the voucher"
                            className="h-9 w-64 text-sm"
                        />
                    )}
                </Field>
                {canPay && (
                    <Button
                        type="button"
                        className="ml-auto"
                        onClick={pay}
                        disabled={saving || !sourceId || !chosen.length || badAmount}
                    >
                        <HandCoins size={15} />
                        {saving ? "Paying…" : chosen.length ? `Pay ${formatRupeesFromPaise(totalPaise)}` : "Pay"}
                    </Button>
                )}
            </div>

            <p className="flex min-h-10 items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 opacity-0" aria-hidden="true" />
                <span>
                    {data
                        ? `${owed.length} owed ${formatInr(totalOwed)} in all${advances.length ? `, and ${advances.length} holding an advance` : ""}.`
                        : "Reading who is owed…"}
                    {refreshing && " · refreshing…"}
                    {" "}These figures come from each salary ledger, so an advance is already netted off.
                </span>
            </p>

            {error && <QueryStateBlock loading={false} error={error} hasData={!!data} onRetry={reload} />}

            <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search staff"
                    aria-label="Search staff to pay"
                    disabled={!data}
                    className="h-9 w-72 pl-8 text-sm"
                />
            </div>

            <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-10">
                                <Checkbox
                                    checked={allPicked}
                                    disabled={!canPay || !rows.length}
                                    onCheckedChange={toggleAll}
                                    aria-label="Pay everyone on this list"
                                />
                            </TableHead>
                            <TableHead>Staff</TableHead>
                            <TableHead className="text-right">Owed</TableHead>
                            <TableHead className="text-right">Paying now</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!data && (
                            <TableRow>
                                <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">Reading…</TableCell>
                            </TableRow>
                        )}
                        {data && !rows.length && (
                            <TableRow>
                                <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                                    {owed.length ? "Nobody matches that search." : "Nobody is owed anything — post a payroll run first."}
                                </TableCell>
                            </TableRow>
                        )}
                        {rows.map((r) => (
                            <TableRow key={r.userId} className={picked.has(r.userId) ? "bg-muted/30" : undefined}>
                                <TableCell>
                                    <Checkbox
                                        checked={picked.has(r.userId)}
                                        disabled={!canPay}
                                        onCheckedChange={() => toggle(r.userId)}
                                        aria-label={`Pay ${r.name}`}
                                    />
                                </TableCell>
                                <TableCell>
                                    <span className="font-medium">{r.name}</span>
                                    {r.staffCode && <span className="ml-2 text-xs text-muted-foreground">{r.staffCode}</span>}
                                    {r.hasLeft && (
                                        <Badge variant="outline" className="ml-2 text-muted-foreground">
                                            Left {r.leftOn ? formatDate(r.leftOn) : ""}
                                        </Badge>
                                    )}
                                </TableCell>
                                <TableCell className="text-right font-medium tabular-nums">{formatInr(r.balance)}</TableCell>
                                <TableCell className="text-right">
                                    {/* Blank means the whole balance. Typing less pays part of
                                        it; typing more leaves them holding an advance, which is
                                        allowed and is exactly what a debit balance means. */}
                                    <Input
                                        value={amounts[r.userId] ?? ""}
                                        onChange={(e) => setAmounts((m) => ({ ...m, [r.userId]: e.target.value }))}
                                        placeholder={String(r.balance)}
                                        inputMode="decimal"
                                        aria-label={`Amount to pay ${r.name}`}
                                        disabled={!canPay || !picked.has(r.userId)}
                                        className="h-8 w-32 text-right text-sm tabular-nums"
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {!!advances.length && (
                <p className="text-xs text-muted-foreground">
                    Holding an advance, so not on the list:{" "}
                    {advances.map((a) => `${a.name} (${formatInr(Math.abs(a.balance))})`).join(", ")}. The next
                    payroll run credits them and clears it by itself.
                </p>
            )}
        </div>
    );
}

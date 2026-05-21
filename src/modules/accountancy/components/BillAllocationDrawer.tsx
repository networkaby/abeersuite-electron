"use client";
// Bill-wise allocation drawer — appears on Receipt / Payment / Credit Note /
// Debit Note vouchers when a party account is selected. Lets the user pick
// which open bills the new voucher settles, mirroring Tally's four allocation
// methods: New Ref / Against Ref / Advance / On Account.
//
// State is held by the parent GlVoucherForm — this component is purely a controlled
// UI on the `allocations` array. Allocations are persisted to the
// VoucherAllocation table after the parent voucher is saved.

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmt } from "@/utils/constants";

type AllocationMethod = "NEW_REF" | "AGAINST_REF" | "ADVANCE" | "ON_ACCOUNT";

export type AllocationDraft = {
    targetType: "INVOICE" | "VOUCHER";
    targetId:   number;
    targetRef:  string;
    amount:     number;
    method:     AllocationMethod;
};

type OpenInvoice = {
    kind:        "invoice";
    id:          number;
    reference:   string;
    date:        string;
    dueDate:     string;
    totalAmount: number;
    allocated:   number;
    outstanding: number;
};
type OpenVoucher = {
    kind:        "voucher";
    id:          number;
    voucherType: string;
    reference:   string;
    date:        string;
    totalAmount: number;
    allocated:   number;
    outstanding: number;
};
type OpenBill = OpenInvoice | OpenVoucher;
type OpenResponse = { openInvoices: OpenInvoice[]; openVouchers: OpenVoucher[]; openTotal: number };

const METHOD_LABELS: Record<AllocationMethod, string> = {
    NEW_REF:     "New Ref (creates a new bill)",
    AGAINST_REF: "Against Ref (settles an existing bill)",
    ADVANCE:     "Advance (paid before the matching bill)",
    ON_ACCOUNT:  "On Account (unallocated)",
};

export function BillAllocationDrawer({
    accountId, voucherAmount, allocations, onChange,
}: {
    accountId:     number;
    voucherAmount: number;          // total voucher amount being entered
    allocations:   AllocationDraft[];
    onChange:      (next: AllocationDraft[]) => void;
}) {
    const [open, setOpen] = useState(true);
    const [openBills, setOpenBills] = useState<OpenBill[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (!accountId) { setOpenBills([]); return; }
        setLoading(true);
        axios.get<OpenResponse>(`/api/accountancy/allocations/open?accountId=${accountId}`)
            .then((r) => setOpenBills([...r.data.openInvoices, ...r.data.openVouchers]))
            .catch(() => toast.error("Failed to load open bills"))
            .finally(() => setLoading(false));
    }, [accountId]);

    const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
    const remaining = voucherAmount - totalAllocated;

    const allocateToBill = (bill: OpenBill, amount: number) => {
        const next = [
            ...allocations.filter((a) => !(a.targetType === bill.kind.toUpperCase() && a.targetId === bill.id)),
            ...(amount > 0 ? [{
                targetType: (bill.kind === "invoice" ? "INVOICE" : "VOUCHER") as "INVOICE" | "VOUCHER",
                targetId:   bill.id,
                targetRef:  bill.reference,
                amount,
                method:     "AGAINST_REF" as AllocationMethod,
            }] : []),
        ];
        onChange(next);
    };

    const setOnAccount = (amount: number) => {
        const next = [
            ...allocations.filter((a) => a.method !== "ON_ACCOUNT"),
            ...(amount > 0 ? [{
                targetType: "INVOICE" as const,
                targetId:   0,
                targetRef:  "ON ACCOUNT",
                amount,
                method:     "ON_ACCOUNT" as AllocationMethod,
            }] : []),
        ];
        onChange(next);
    };

    if (!accountId) return null;

    return (
        <div className="rounded-lg border border-border bg-card shadow">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full px-5 py-3 flex items-center justify-between hover:bg-muted/40"
            >
                <div className="text-left">
                    <h3 className="text-sm font-semibold">Bill-wise Allocation</h3>
                    <p className="text-xs text-muted-foreground">
                        {totalAllocated > 0
                            ? `₹ ${fmt(totalAllocated)} allocated · ₹ ${fmt(Math.max(0, remaining))} remaining`
                            : "Optionally link this voucher to one or more open bills"}
                    </p>
                </div>
                {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {open && (
                <div className="border-t border-border px-5 py-4 space-y-4">
                    {loading ? (
                        <div className="flex justify-center py-6">
                            <Loader2 className="animate-spin text-muted-foreground" size={20} />
                        </div>
                    ) : openBills.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                            No open bills for this party. Use <em>On Account</em> below if you want to record this as unallocated.
                        </div>
                    ) : (
                        <div className="overflow-hidden rounded border border-border">
                            <table className="w-full text-sm">
                                <thead className="bg-muted text-xs text-muted-foreground border-b border-border">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium">Bill</th>
                                        <th className="px-3 py-2 text-left font-medium">Date</th>
                                        <th className="px-3 py-2 text-right font-medium">Total</th>
                                        <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                                        <th className="px-3 py-2 text-right font-medium w-32">Allocate</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {openBills.map((bill) => {
                                        const existing = allocations.find((a) =>
                                            a.targetType === bill.kind.toUpperCase() && a.targetId === bill.id,
                                        );
                                        return (
                                            <tr key={`${bill.kind}-${bill.id}`} className="border-b last:border-0 hover:bg-muted/40">
                                                <td className="px-3 py-2 font-mono text-xs">{bill.reference}</td>
                                                <td className="px-3 py-2 text-muted-foreground text-xs">
                                                    {new Date(bill.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                                                </td>
                                                <td className="px-3 py-2 text-right font-mono text-xs">{fmt(bill.totalAmount)}</td>
                                                <td className="px-3 py-2 text-right font-mono text-xs text-orange-600">{fmt(bill.outstanding)}</td>
                                                <td className="px-3 py-2">
                                                    <Input
                                                        type="text" inputMode="decimal"
                                                        value={existing?.amount ?? ""}
                                                        placeholder="0.00"
                                                        onChange={(e) => {
                                                            const val = parseFloat(e.target.value) || 0;
                                                            allocateToBill(bill, Math.min(val, bill.outstanding));
                                                        }}
                                                        className="text-right text-xs"
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* On Account / Advance — for unallocated balance */}
                    {remaining > 0.005 && (
                        <div className="rounded border border-border p-3 bg-muted/30 space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">
                                ₹ {fmt(remaining)} remains unallocated. Park as:
                            </p>
                            <div className="flex gap-2">
                                <Button type="button" size="sm" variant="outline" onClick={() => setOnAccount(remaining)}>
                                    On Account
                                </Button>
                                <span className="text-xs text-muted-foreground self-center">
                                    (You can settle it later by linking from this voucher)
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Allocations summary */}
                    {allocations.length > 0 && (
                        <div className="rounded border border-border bg-muted/30 p-3 space-y-1">
                            <p className="text-xs font-medium">Current allocations:</p>
                            {allocations.map((a, i) => (
                                <div key={i} className="flex justify-between text-xs">
                                    <span><span className="font-mono">{a.targetRef}</span> · {METHOD_LABELS[a.method]}</span>
                                    <span className="font-mono">₹ {fmt(a.amount)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

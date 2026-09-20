"use client";

// "Salary slips" on a person's own profile page.
//
// Owner, 2026-09-20: "display in users own profile so they can see. print will
// be later." So this is a reading surface, not a document: a person opens their
// own profile and sees what they were paid for each period, and can open any
// one to see the pay heads behind it.
//
// Only POSTED runs appear. A draft has not happened yet and a cancelled one has
// been taken back out of the books, so neither is a slip. Every figure is the
// run's own frozen line, never recomputed.
//
// Clicking a row expands it, the same gesture as the payroll sheet and
// VoucherRegisterTable.

import { Fragment, useState } from "react";
import { Receipt } from "lucide-react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryStateBlock } from "@/shared/components/QueryStateBlock";
import { useApiResource } from "@/shared/hooks";
import { formatDate } from "@/shared/lib/format/formatDate";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { formatPeriod, type PayslipDto } from "../lib/payrollTypes";

export default function StaffPayslips({ userId }: { userId: number }) {
    // No `loading`: the table is always mounted and says "Reading…" in its body.
    const { data, error, reload } = useApiResource<PayslipDto[]>(`/api/hr/staff/${userId}/payslips`);
    const [open, setOpen] = useState<Set<number>>(new Set());

    const toggle = (id: number) => setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const slips = data ?? [];
    const totalNet = slips.reduce((s, x) => s + x.netPaise, 0);

    return (
        <div className="space-y-4">
            <div>
                <h3 className="flex items-center gap-2 text-base font-semibold">
                    <Receipt size={16} /> Salary slips
                </h3>
                <p className="text-sm text-muted-foreground">
                    {data
                        ? slips.length
                            ? `${slips.length} slip${slips.length === 1 ? "" : "s"} · ${formatRupeesFromPaise(totalNet)} in all`
                            : "No salary has been posted yet."
                        : "Reading the slips…"}
                </p>
            </div>

            {error && <QueryStateBlock loading={false} error={error} hasData={!!data} onRetry={reload} />}

            <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-8" />
                            <TableHead>Period</TableHead>
                            <TableHead>Days paid</TableHead>
                            <TableHead className="text-right">Gross</TableHead>
                            <TableHead className="text-right">Deductions</TableHead>
                            <TableHead className="text-right">Net</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!data && (
                            <TableRow>
                                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                                    Reading…
                                </TableCell>
                            </TableRow>
                        )}
                        {data && !slips.length && (
                            <TableRow>
                                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                                    Nothing yet — a slip appears here once a payroll run covering you is posted.
                                </TableCell>
                            </TableRow>
                        )}
                        {slips.map((s) => (
                            <Fragment key={s.id}>
                                <TableRow
                                    className="cursor-pointer"
                                    title="Click to see the pay heads"
                                    onClick={() => toggle(s.id)}
                                >
                                    <TableCell className="text-muted-foreground">
                                        {open.has(s.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    </TableCell>
                                    <TableCell className="font-medium">{formatPeriod(s.periodFrom, s.periodTo)}</TableCell>
                                    <TableCell className="text-sm text-muted-foreground tabular-nums">
                                        {s.paidDays} of {s.periodDays}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">{formatRupeesFromPaise(s.grossPaise)}</TableCell>
                                    <TableCell className="text-right tabular-nums text-muted-foreground">
                                        {s.deductionsPaise ? formatRupeesFromPaise(s.deductionsPaise) : "—"}
                                    </TableCell>
                                    <TableCell className="text-right font-medium tabular-nums">{formatRupeesFromPaise(s.netPaise)}</TableCell>
                                </TableRow>

                                {open.has(s.id) && (
                                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                                        <TableCell />
                                        <TableCell colSpan={5} className="py-3">
                                            <div className="max-w-md space-y-1.5">
                                                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                                    Pay heads for {s.paidDays} of {s.periodDays} days
                                                </p>
                                                {s.lines.map((h) => (
                                                    <div
                                                        key={`${h.kind}-${h.name}`}
                                                        className={`flex justify-between text-sm ${h.kind === "DEDUCTION" ? "text-muted-foreground" : ""}`}
                                                    >
                                                        <span>{h.name}</span>
                                                        <span className="tabular-nums">
                                                            {formatRupeesFromPaise(h.kind === "DEDUCTION" ? -h.amountPaise : h.amountPaise)}
                                                        </span>
                                                    </div>
                                                ))}
                                                <div className="flex justify-between border-t border-border pt-1.5 text-sm font-medium">
                                                    <span>Net for this period</span>
                                                    <span className="tabular-nums">{formatRupeesFromPaise(s.netPaise)}</span>
                                                </div>
                                                <p className="pt-1 text-xs text-muted-foreground">
                                                    Posted {s.postedAt ? formatDate(s.postedAt) : formatDate(s.postingDate)}
                                                    {s.voucherRef && ` · ${s.voucherRef}`}
                                                </p>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </Fragment>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <p className="text-xs text-muted-foreground">
                This is what was earned for each period. When it was actually paid shows on the salary
                ledger itself — a printable slip comes later.
            </p>
        </div>
    );
}

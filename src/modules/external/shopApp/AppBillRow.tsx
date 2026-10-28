"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Download, FileText, Loader2, Share2 } from "lucide-react";
import { formatInr } from "@/shared/lib/format/moneyInr";
import type { BillDetail, BillDetailRow } from "@/modules/external/portal/portalBillDetail";
import { APP } from "./appPaths";

// One fetch per bill per app visit: a second tap, or flipping between bills,
// reads this instead of the network. A failed fetch is forgotten so a tap retries.
const details = new Map<number, Promise<BillDetail>>();
function loadDetail(uvId: number): Promise<BillDetail> {
    let p = details.get(uvId);
    if (!p) {
        p = fetch(`/api/portal/bill/${uvId}`).then((res) => {
            if (!res.ok) throw new Error("Could not open this bill");
            return res.json() as Promise<BillDetail>;
        });
        p.catch(() => details.delete(uvId));
        details.set(uvId, p);
    }
    return p;
}

/**
 * A bill in My Bills: tap it and it opens in place — the items, charges, tax,
 * total, what was paid and what is still due — with View, Download and Share.
 * `summary` is the row as the list shows it (number, date, total, chip).
 */
export default function AppBillRow({ uvId, summary }: { uvId: number; summary: ReactNode }) {
    const [open, setOpen] = useState(false);
    const [detail, setDetail] = useState<BillDetail | null>(null);
    const [error, setError] = useState<string | null>(null);

    const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next && !detail) {
            setError(null);
            loadDetail(uvId).then(setDetail, (e: Error) => setError(e.message));
        }
    };

    return (
        <div className={open ? "bg-muted/30" : ""}>
            <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted">
                {summary}
                <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
                <div className="px-4 pb-4">
                    {error ? (
                        <p className="py-4 text-center text-sm text-destructive">{error}</p>
                    ) : !detail ? (
                        <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" /> Opening bill…
                        </p>
                    ) : (
                        <BillBody detail={detail} />
                    )}
                </div>
            )}
        </div>
    );
}

function BillBody({ detail: d }: { detail: BillDetail }) {
    const bill = `${APP}/bill/${d.detailId}`;
    return (
        <div className="rounded-xl border bg-background">
            <ul className="divide-y">
                {d.items.map((it, i) => (
                    <li key={i} className="flex gap-3 px-3 py-2.5">
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm">{it.name}</span>
                            {it.note && <span className="block text-xs text-muted-foreground">{it.note}</span>}
                            <span className="block text-xs text-muted-foreground tabular-nums">
                                {it.qty}
                                {it.unit ? ` ${it.unit}` : ""}
                                {it.rate != null ? ` × ${formatInr(it.rate)}` : ""}
                            </span>
                        </span>
                        {it.amount != null && <span className="shrink-0 text-sm tabular-nums">{formatInr(it.amount)}</span>}
                    </li>
                ))}
            </ul>
            <div className="space-y-1 border-t px-3 py-2.5 text-sm">
                {d.charges.map((r, i) => (
                    <Line key={`c${i}`} row={r} />
                ))}
                {d.tax.map((r, i) => (
                    <Line key={`t${i}`} row={r} />
                ))}
                {d.roundOff != null && Math.abs(d.roundOff) > 0.005 && <Line row={{ label: "Round off", amount: d.roundOff }} />}
                {d.total != null && (
                    <div className="flex justify-between pt-1 text-base font-semibold">
                        <span>Total</span>
                        <span className="tabular-nums">{formatInr(d.total)}</span>
                    </div>
                )}
                {d.paid.map((r, i) => (
                    <Line key={`p${i}`} row={{ label: `Paid · ${r.label}`, amount: r.amount }} tone="text-emerald-700 dark:text-emerald-400" />
                ))}
                {d.balanceDue != null && d.balanceDue > 0.005 && (
                    <div className="flex justify-between font-semibold text-amber-700 dark:text-amber-400">
                        <span>Balance due</span>
                        <span className="tabular-nums">{formatInr(d.balanceDue)}</span>
                    </div>
                )}
            </div>
            <div className="grid grid-cols-3 divide-x border-t text-sm font-medium text-primary">
                <Link href={bill} className="flex items-center justify-center gap-1.5 py-3 active:bg-muted">
                    <FileText className="size-4" /> View
                </Link>
                <Link href={`${bill}?act=download`} className="flex items-center justify-center gap-1.5 py-3 active:bg-muted">
                    <Download className="size-4" /> Download
                </Link>
                <Link href={`${bill}?act=share`} className="flex items-center justify-center gap-1.5 py-3 active:bg-muted">
                    <Share2 className="size-4" /> Share
                </Link>
            </div>
        </div>
    );
}

function Line({ row, tone = "text-muted-foreground" }: { row: BillDetailRow; tone?: string }) {
    return (
        <div className={`flex justify-between gap-3 ${tone}`}>
            <span className="min-w-0 truncate">{row.label}</span>
            <span className="shrink-0 tabular-nums">{row.amount < 0 ? `(−) ${formatInr(-row.amount)}` : formatInr(row.amount)}</span>
        </div>
    );
}

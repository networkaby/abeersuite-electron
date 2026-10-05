"use client";

import { useCallback, useEffect, useState } from "react";
import { formatInr } from "@/shared/lib/format/moneyInr";
import MobileHeader from "./MobileHeader";
import { when } from "./MobilePartyVouchers";
import { useMobileResource } from "../hooks/useMobileResource";
import type { VoucherView } from "../lib/types";

/**
 * Open / close the voucher sheet over a list. Opening adds a history entry
 * (`?voucher=<id>`), so the phone's own Back closes the sheet and leaves the list
 * exactly as it was — the Day Book's day, the party's loaded pages.
 */
export function useVoucherSheet() {
    const [openId, setOpenId] = useState<number | null>(null);
    useEffect(() => {
        const onPop = () => setOpenId(null);
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);
    const open = useCallback((id: number) => {
        const url = new URL(window.location.href);
        url.searchParams.set("voucher", String(id));
        window.history.pushState(null, "", url);
        setOpenId(id);
    }, []);
    const close = useCallback(() => window.history.back(), []);
    return { openId, open, close };
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className={`flex justify-between gap-3 py-1 ${strong ? "text-base font-semibold" : "text-sm"}`}>
            <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
            <span>{value}</span>
        </div>
    );
}

const sectionTitle = "px-3 pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground";

/**
 * One voucher, view only, laid over the list it was tapped in: who / when, the
 * items sold (qty × price with GST, the line note under), services and charges,
 * the bill figures, how it was paid, and the ledger legs (all a Receipt / Payment /
 * Journal has). Read from /api/mobile/vouchers/[id]; the phone keeps each one it
 * has opened, so a second look shows at once and only asks "anything new?".
 */
export default function MobileVoucherSheet({ id, userId, onClose }: {
    id: number;
    userId: string;
    onClose: () => void;
}) {
    const { data: v, loading, error, refresh } = useMobileResource<VoucherView>(
        `/api/mobile/vouchers/${id}`, `voucher:${id}`, userId, { since: true },
    );

    return (
        <div className="fixed inset-0 z-30 overflow-y-auto bg-background pb-[env(safe-area-inset-bottom)]">
            <MobileHeader title={v ? `${v.kind} ${v.ref}` : "Voucher"} back={onClose} onRefresh={refresh} busy={loading} />

            {error && <p className="px-3 pt-2 text-sm text-destructive">{error}</p>}
            {!v && loading && <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>}

            {v && (
                <>
                    <div className="space-y-0.5 border-b px-3 py-3">
                        {v.party && <p className="font-medium">{v.party}</p>}
                        <p className="text-sm text-muted-foreground">
                            {when(v.date, v.savedAt)}{v.by ? ` · ${v.by}` : ""}
                        </p>
                        {v.status !== "POSTED" && (
                            <p className="text-sm font-medium text-destructive">{v.status === "CANCELLED" ? "Cancelled" : "Draft"}</p>
                        )}
                        {v.narration && <p className="pt-1 text-sm">{v.narration}</p>}
                    </div>

                    {v.items.length > 0 && (
                        <>
                            <p className={sectionTitle}>Items ({v.items.length})</p>
                            <ul className="divide-y border-y">
                                {v.items.map((it, i) => (
                                    <li key={i} className="flex items-start gap-3 px-3 py-2.5">
                                        <div className="min-w-0 flex-1">
                                            <p className="leading-snug">{it.name}</p>
                                            {it.note && <p className="text-xs text-muted-foreground">{it.note}</p>}
                                            <p className="text-xs text-muted-foreground">
                                                {it.qty} × {formatInr(it.rate)}{it.freeQty > 0 ? ` + ${it.freeQty} free` : ""}
                                            </p>
                                        </div>
                                        <p className="shrink-0 font-medium">{formatInr(it.amount)}</p>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}

                    {v.charges.length > 0 && (
                        <>
                            <p className={sectionTitle}>Services &amp; charges</p>
                            <ul className="divide-y border-y">
                                {v.charges.map((c, i) => (
                                    <li key={i} className="flex items-start gap-3 px-3 py-2.5">
                                        <div className="min-w-0 flex-1">
                                            <p className="leading-snug">{c.name}</p>
                                            {c.qty != null && c.rate != null && (
                                                <p className="text-xs text-muted-foreground">{c.qty} × {formatInr(c.rate)}</p>
                                            )}
                                        </div>
                                        <p className="shrink-0 font-medium">{formatInr(c.amount)}</p>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}

                    {v.bill && (
                        <div className="border-b px-3 py-2">
                            {v.bill.discount !== 0 && <Row label="Discount" value={`− ${formatInr(v.bill.discount)}`} />}
                            {v.bill.shipping !== 0 && <Row label="Shipping" value={formatInr(v.bill.shipping)} />}
                            {v.bill.roundOff !== 0 && <Row label="Round off" value={formatInr(v.bill.roundOff)} />}
                            <Row label="Total" value={formatInr(v.bill.total)} strong />
                            {v.bill.tax !== 0 && <Row label="GST included" value={formatInr(v.bill.tax)} />}
                        </div>
                    )}

                    {v.bill && (
                        <>
                            <p className={sectionTitle}>Paid</p>
                            <div className="border-y px-3 py-2">
                                {v.paid.length === 0
                                    ? <p className="py-1 text-sm text-muted-foreground">Nothing taken — on credit</p>
                                    : v.paid.map((p, i) => <Row key={i} label={p.name} value={formatInr(p.amount)} />)}
                            </div>
                        </>
                    )}

                    {/* A bill's legs repeat the figures above; everything else is its legs. */}
                    {!v.bill && v.legs.length > 0 && (
                        <>
                            <p className={sectionTitle}>Accounts</p>
                            <ul className="divide-y border-y">
                                {v.legs.map((l, i) => (
                                    <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                                        <p className="min-w-0 flex-1 leading-snug">{l.name}</p>
                                        <p className="shrink-0 text-sm">
                                            <span className="font-medium">{formatInr(l.amount)}</span>{" "}
                                            <span className="text-muted-foreground">{l.side}</span>
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                    <div className="h-6" />
                </>
            )}
        </div>
    );
}

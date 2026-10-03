"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import { formatInr } from "@/shared/lib/format/moneyInr";
import { formatDate } from "@/shared/lib/format/formatDate";
import MobileHeader from "./MobileHeader";
import { balanceLabel } from "../lib/partyBalance";
import Link from "next/link";
import { useMobileResource } from "../hooks/useMobileResource";
import { MOBILE_SETUP_FRESH_MS } from "@/shared/lib/constants/polling";
import type { PartyDetail, PaySetup } from "../lib/types";
import { useMobileList } from "../hooks/useMobileList";
import MobilePartyVouchers, { type PartyVoucher } from "./MobilePartyVouchers";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

/** One party: balance, Pay / Receive, then two tabs — its vouchers, newest first
 *  with the running balance (/api/mobile/parties/[accountId]/vouchers, asked on
 *  every open so a voucher just saved shows), and its unpaid bills
 *  (/api/mobile/parties/[accountId]). `back` is the list the party was opened from.
 *  Pay / Receive show for whoever holds the Payment / Receipt create + post ticks;
 *  the one matching the balance's direction is the main button. Bills ticked on the
 *  bills tab ride along (`?bills=`): a bill they owe goes to Receive, one we owe to Pay.
 *  Each of the party's numbers is a Call button — the phone's own dialler (`tel:`). */
export default function MobilePartyBills({ accountId, userId, name, back }: {
    accountId: number;
    userId: string;
    name: string | null;
    back: string;
}) {
    const { data, loading, error, refresh } = useMobileResource<PartyDetail>(
        `/api/mobile/parties/${accountId}`, `party:${accountId}`, userId, { since: true },
    );
    const setup = useMobileResource<PaySetup>("/api/mobile/pay-setup", "pay-setup", userId, { freshMs: MOBILE_SETUP_FRESH_MS }).data;
    // freshMs 0: the whole point of this list is "has it landed yet?" — every open
    // asks, with `?since=`, so a quiet book still costs one tiny reply.
    const vouchers = useMobileList<PartyVoucher>(`/api/mobile/parties/${accountId}/vouchers`, "", userId, {}, { freshMs: 0 });
    const [tab, setTab] = useState<"vouchers" | "bills">("vouchers");
    // Ticked bills, by universalVoucherId — only a bill with one can be settled.
    const [picked, setPicked] = useState<Set<number>>(() => new Set());

    const billsNet = data ? data.bills.reduce((s, b) => s + b.side * b.outstanding, 0) : 0;
    // Money received / paid on account — moves the balance, settles no bill.
    const onAccount = data ? Math.round((data.balance - billsNet) * 100) / 100 : 0;
    const balance = balanceLabel(data?.balance ?? 0);
    const canTick = (side: 1 | -1) => (side > 0 ? setup?.canReceive : setup?.canPay) ?? false;
    const togglePick = (id: number) => setPicked((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
    });
    // The ticked bills on one side — what that side's button carries and says.
    const pickedFor = (side: 1 | -1) => {
        const list = (data?.bills ?? []).filter((b) => b.side === side && b.universalVoucherId != null && picked.has(b.universalVoucherId));
        const total = Math.round(list.reduce((s, b) => s + b.outstanding, 0) * 100) / 100;
        return {
            query: list.length ? `&bills=${list.map((b) => b.universalVoucherId).join(",")}` : "",
            label: list.length ? ` ${formatInr(total)} (${list.length} bill${list.length === 1 ? "" : "s"})` : "",
        };
    };
    const receivePick = pickedFor(1);
    const payPick = pickedFor(-1);

    return (
        <>
            <MobileHeader
                title={data?.name ?? name ?? "Party"}
                back={back}
                onRefresh={() => { refresh(); vouchers.refresh(); }}
                busy={loading || vouchers.loading}
            />

            {(error ?? vouchers.error) && <p className="px-3 pt-2 text-sm text-destructive">{error ?? vouchers.error}</p>}

            {data && (
                <>
                    <div className="space-y-1 border-b px-3 py-4">
                        <p className="text-xs text-muted-foreground">Balance</p>
                        <p className={`text-2xl font-semibold ${balance.tone}`}>{balance.text}</p>
                        <p className="text-sm text-muted-foreground">
                            Unpaid bills ({data.bills.length}): {formatInr(Math.abs(billsNet))}
                        </p>
                        {onAccount !== 0 && (
                            <p className="text-sm text-muted-foreground">
                                Not against any bill: {formatInr(Math.abs(onAccount))} {onAccount > 0 ? "they owe" : "we owe"}
                            </p>
                        )}
                        {data.phones.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-2">
                                {data.phones.map((p) => (
                                    <a
                                        key={p.phone}
                                        href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/40 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400"
                                    >
                                        <Phone className="size-4" aria-hidden />
                                        Call {p.phone}{p.label ? ` · ${p.label}` : ""}
                                    </a>
                                ))}
                            </div>
                        )}
                        {(setup?.canPay || setup?.canReceive) && (
                            <div className="flex gap-2 pt-3">
                                {setup.canReceive && (
                                    <Link
                                        href={`${PHONE_APP_HOME}/parties/${accountId}/receive?from=${back}${receivePick.query}`}
                                        className={`flex-1 rounded-lg py-2.5 text-center font-medium ${data.balance > 0 ? "bg-primary text-primary-foreground" : "border"}`}
                                    >
                                        Receive{receivePick.label}
                                    </Link>
                                )}
                                {setup.canPay && (
                                    <Link
                                        href={`${PHONE_APP_HOME}/parties/${accountId}/pay?from=${back}${payPick.query}`}
                                        className={`flex-1 rounded-lg py-2.5 text-center font-medium ${data.balance < 0 ? "bg-primary text-primary-foreground" : "border"}`}
                                    >
                                        Pay{payPick.label}
                                    </Link>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="sticky top-[53px] z-10 flex border-b bg-background">
                        {([["vouchers", "Vouchers"], ["bills", `Unpaid bills (${data.bills.length})`]] as const).map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setTab(key)}
                                className={`flex-1 py-3 text-sm ${tab === key ? "border-b-2 border-primary font-semibold text-primary" : "text-muted-foreground"}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    {tab === "vouchers" ? (
                        <>
                            <MobilePartyVouchers items={vouchers.items} />
                            {!vouchers.loading && vouchers.empty && (
                                <p className="p-6 text-center text-sm text-muted-foreground">No vouchers yet.</p>
                            )}
                            {vouchers.hasMore && (
                                <button type="button" onClick={vouchers.loadMore} disabled={vouchers.loading} className="m-3 w-[calc(100%-1.5rem)] rounded-lg border py-3 text-sm">
                                    {vouchers.loading ? "Loading…" : "Load more"}
                                </button>
                            )}
                        </>
                    ) : data.bills.length === 0 ? (
                        <p className="p-6 text-center text-sm text-muted-foreground">No unpaid bills.</p>
                    ) : (
                        <ul className="divide-y">
                            {data.bills.map((b) => {
                                const id = b.universalVoucherId;
                                const tickable = id != null && canTick(b.side);
                                return (
                                    <li key={b.key}>
                                        <label className={`flex items-start gap-3 px-3 py-3 ${tickable ? "cursor-pointer" : ""}`}>
                                            {tickable && (
                                                <input
                                                    type="checkbox"
                                                    checked={picked.has(id)}
                                                    onChange={() => togglePick(id)}
                                                    className="mt-1 size-4 shrink-0 accent-primary"
                                                    aria-label={`Tick ${b.ref}`}
                                                />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="font-medium">{b.ref}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatDate(b.billDate)} · Bill {formatInr(b.totalAmount)}
                                                </p>
                                            </div>
                                            <div className="shrink-0 text-right">
                                                <p className={`font-semibold ${b.side > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                                                    {formatInr(b.outstanding)}
                                                </p>
                                                <p className={`text-xs ${b.daysOverdue > 60 ? "text-destructive" : "text-muted-foreground"}`}>
                                                    {b.daysOverdue} days
                                                </p>
                                            </div>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </>
            )}
            {!data && loading && <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>}
        </>
    );
}

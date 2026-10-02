"use client";

import { formatInr } from "@/shared/lib/format/moneyInr";
import { formatDate } from "@/shared/lib/format/formatDate";
import MobileHeader from "./MobileHeader";
import { balanceLabel } from "./partyBalance";
import { useMobileResource } from "./useMobileResource";

type PartyDetail = {
    accountId: number;
    name: string;
    /** + they owe us, − we owe them. */
    balance: number;
    bills: {
        key: string;
        ref: string;
        billDate: string;
        totalAmount: number;
        /** Unsigned; `side` says which way it runs (+1 they owe us, −1 we owe them). */
        outstanding: number;
        side: 1 | -1;
        daysOverdue: number;
    }[];
};

/** One party's balance and unpaid bills (/api/mobile/parties/[accountId]). `back` is
 *  the list the party was opened from (party search, receivables, payables). */
export default function MobilePartyBills({ accountId, userId, name, back }: {
    accountId: number;
    userId: string;
    name: string | null;
    back: string;
}) {
    const { data, loading, error, refresh } = useMobileResource<PartyDetail>(
        `/api/mobile/parties/${accountId}`, `party:${accountId}`, userId,
    );

    const billsNet = data ? data.bills.reduce((s, b) => s + b.side * b.outstanding, 0) : 0;
    // Money received / paid on account — moves the balance, settles no bill.
    const onAccount = data ? Math.round((data.balance - billsNet) * 100) / 100 : 0;
    const balance = balanceLabel(data?.balance ?? 0);

    return (
        <>
            <MobileHeader title={data?.name ?? name ?? "Party"} back={back} onRefresh={refresh} busy={loading} />

            {error && <p className="px-3 pt-2 text-sm text-destructive">{error}</p>}

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
                    </div>
                    {data.bills.length === 0 ? (
                        <p className="p-6 text-center text-sm text-muted-foreground">No unpaid bills.</p>
                    ) : (
                        <ul className="divide-y">
                            {data.bills.map((b) => (
                                <li key={b.key} className="flex items-start gap-3 px-3 py-3">
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
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
            {!data && loading && <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>}
        </>
    );
}

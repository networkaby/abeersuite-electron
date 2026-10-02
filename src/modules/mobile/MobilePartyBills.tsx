"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { formatInr } from "@/shared/lib/format/moneyInr";
import { formatDate } from "@/shared/lib/format/formatDate";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { readCache, userScopedKey, writeCache } from "@/shared/lib/browser/pollCache";
import type { LedgerOutstanding } from "@/modules/accountancy/lib/outstandings";
import MobileHeader from "./MobileHeader";
import { balanceLabel } from "./partyBalance";

/** One party's unpaid bills — the same engine as the Receivables report
 *  (/api/accountancy/outstandings/[accountId]). Cached per party, so the next
 *  visit shows the last figures at once while the fresh ones load. */
export default function MobilePartyBills({ accountId, userId, name }: { accountId: number; userId: string; name: string | null }) {
    const key = userScopedKey(`m:outstanding:${accountId}`, userId);
    const [data, setData] = useState<LedgerOutstanding | null>(() => readCache<LedgerOutstanding>(key)?.data ?? null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data: fresh } = await axios.get<LedgerOutstanding>(`/api/accountancy/outstandings/${accountId}`);
            setData(fresh);
            writeCache(key, fresh, new Date().toISOString());
        } catch (e) {
            setError(extractApiError(e, "Could not load bills."));
        } finally {
            setLoading(false);
        }
    }, [accountId, key]);

    useEffect(() => { void load(); }, [load]);

    // A bill's `outstanding` is unsigned; `side` says which way it runs.
    const net = data ? data.bills.reduce((s, b) => s + b.side * b.outstanding, 0) : 0;
    const total = balanceLabel(net);

    return (
        <>
            <MobileHeader title={data?.accountName ?? name ?? "Party"} back="/m/parties" onRefresh={() => void load()} busy={loading} />

            {error && <p className="px-3 pt-2 text-sm text-destructive">{error}</p>}

            {data && (
                <>
                    <div className="border-b px-3 py-4">
                        <p className="text-xs text-muted-foreground">Unpaid bills ({data.bills.length})</p>
                        <p className={`text-2xl font-semibold ${total.tone}`}>{total.text}</p>
                    </div>
                    {data.bills.length === 0 ? (
                        <p className="p-6 text-center text-sm text-muted-foreground">No unpaid bills.</p>
                    ) : (
                        <ul className="divide-y">
                            {data.bills.map((b) => (
                                <li key={`${b.kind}:${b.id}`} className="flex items-start gap-3 px-3 py-3">
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

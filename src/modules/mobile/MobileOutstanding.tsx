"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatInr } from "@/shared/lib/format/moneyInr";
import type { AgeingBucket, Buckets } from "@/modules/accountancy/lib/outstandings";
import MobileListScreen from "./MobileListScreen";
import { useMobileResource } from "./useMobileResource";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

type OutstandingParty = {
    accountId: number;
    name: string;
    searchKey: string;
    phone: string | null;
    total: number;
    buckets: Buckets;
    billCount: number;
    oldestDays: number;
};
type OutstandingList = { asOf: string; total: number; buckets: Buckets; billCount: number; parties: OutstandingParty[] };

const AGES: { key: AgeingBucket; label: string }[] = [
    { key: "b0_30", label: "0–30 days" },
    { key: "b30_60", label: "31–60" },
    { key: "b60_90", label: "61–90" },
    { key: "b90_plus", label: "90+" },
];

const SIDE = {
    receivables: { title: "Receivables", word: "to receive", tone: "text-destructive", href: `${PHONE_APP_HOME}/receivables` },
    payables: { title: "Payables", word: "to pay", tone: "text-emerald-600 dark:text-emerald-400", href: `${PHONE_APP_HOME}/payables` },
} as const;

/**
 * Who owes us / whom we owe: the total and its age at the top, the parties below,
 * biggest first. An age chip narrows the list to parties with money that old and
 * ranks them by it. Search runs over the list already on the phone (name, phone,
 * GSTIN). Tapping a party opens its bills.
 */
export default function MobileOutstanding({ side, userId }: { side: keyof typeof SIDE; userId: string }) {
    const meta = SIDE[side];
    const { data, loading, error, refresh } = useMobileResource<OutstandingList>(
        `/api/mobile/outstanding/${side}`, `outstanding:${side}`, userId, { since: true },
    );
    const [query, setQuery] = useState("");
    const [age, setAge] = useState<AgeingBucket | null>(null);

    const shown = useMemo(() => {
        const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const amount = (p: OutstandingParty) => (age ? p.buckets[age] : p.total);
        return (data?.parties ?? [])
            .filter((p) => amount(p) > 0.005 && words.every((w) => p.searchKey.includes(w)))
            .sort((a, b) => amount(b) - amount(a));
    }, [data, query, age]);

    const summary = data && (
        <div className="space-y-3 border-b px-3 pb-3">
            <div>
                <p className={`text-2xl font-semibold ${meta.tone}`}>{formatInr(age ? data.buckets[age] : data.total)} {meta.word}</p>
                <p className="text-xs text-muted-foreground">
                    {data.billCount} unpaid bills · {data.parties.length} parties{age ? ` · ${AGES.find((a) => a.key === age)?.label} old` : ""}
                </p>
            </div>
            <div className="flex gap-2 overflow-x-auto">
                {AGES.map(({ key, label }) => {
                    const on = age === key;
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setAge(on ? null : key)}
                            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${on ? "border-primary bg-primary/10 font-semibold text-primary" : ""}`}
                        >
                            {label}
                            <span className="ml-1 text-muted-foreground">{formatInr(data.buckets[key], 0)}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );

    return (
        <MobileListScreen
            title={meta.title}
            placeholder="Party name, phone or GSTIN"
            query={query}
            onQuery={setQuery}
            list={{ loading, error, hasMore: false, empty: shown.length === 0, loadMore: () => { }, refresh }}
            emptyText={data ? "Nothing outstanding here." : "Loading…"}
            summary={summary}
        >
            {shown.map((p) => (
                <li key={p.accountId}>
                    <Link
                        href={`${PHONE_APP_HOME}/parties/${p.accountId}?name=${encodeURIComponent(p.name)}&from=${meta.href}`}
                        className="flex items-start gap-3 px-3 py-3 active:bg-muted"
                    >
                        <div className="min-w-0 flex-1">
                            <p className="font-medium leading-snug">{p.name}</p>
                            <p className="text-xs text-muted-foreground">
                                {[p.phone, `${p.billCount} bill${p.billCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                            </p>
                        </div>
                        <div className="shrink-0 text-right">
                            <p className={`font-semibold ${meta.tone}`}>{formatInr(age ? p.buckets[age] : p.total)}</p>
                            <p className={`text-xs ${p.oldestDays > 60 ? "text-destructive" : "text-muted-foreground"}`}>
                                oldest {p.oldestDays} days
                            </p>
                        </div>
                    </Link>
                </li>
            ))}
        </MobileListScreen>
    );
}

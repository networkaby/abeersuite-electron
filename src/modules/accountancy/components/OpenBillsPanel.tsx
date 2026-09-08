"use client";

// Bill-wise preview beside a Receipt / Payment form — "what does this party
// have open right now?" — shown the moment a party is picked, BEFORE save.
//
// Read-only on purpose: a link is only legal between two posted vouchers, so
// the actual placing still happens in BillLinkDialog straight after posting.
// This panel exists so the counter can SEE the dues while typing the amount,
// and click a bill to take its open amount into the row.

import { useEffect, useState } from "react";
import axios from "axios";
import { Loader2 } from "lucide-react";
import { fmt } from "@/utils/constants";
import { extractApiError } from "@/shared/lib/api";
import type { LinkableDoc } from "@/modules/accountancy/lib/billLinkPlan";

// Same idea as the popup's cache: the party's open bills barely move between
// two keystrokes, and a spinner where a table just was reads as a bug.
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; docs: LinkableDoc[] }>();
// One request per key at a time — React runs the effect more than once around
// a pick (strict mode, re-renders), and each run must not be its own fetch.
const inflight = new Map<string, Promise<LinkableDoc[]>>();

/** Drop the cached open-bill lists — call after anything that changes them. */
export function clearOpenBillsCache(): void {
    cache.clear();
}

function fetchOpenBills(key: string, accountId: number, side: 1 | -1): Promise<LinkableDoc[]> {
    const running = inflight.get(key);
    if (running) return running;
    const p = axios.get<{ docs: LinkableDoc[] }>(`/api/accountancy/allocations/open?accountId=${accountId}&side=${side}`)
        .then((r) => {
            cache.set(key, { at: Date.now(), docs: r.data.docs });
            return r.data.docs;
        })
        .finally(() => { inflight.delete(key); });
    inflight.set(key, p);
    return p;
}

export function OpenBillsPanel({ accountId, partyName, side, onPickAmount }: {
    /** The party ledger whose open bills are shown. */
    accountId:    number;
    partyName?:   string;
    /** +1 = bills they owe us (a Receipt settles these) · −1 = bills we owe (a Payment). */
    side:         1 | -1;
    /** Click a bill → the caller takes its open amount into the row. */
    onPickAmount?: (amount: number) => void;
}) {
    const key = `${accountId}|${side}`;
    // The answer is keyed by the party, so switching party never shows the old
    // party's bills: an answer for another key is simply not this one.
    const [result, setResult] = useState<{ key: string; docs?: LinkableDoc[]; error?: string } | null>(null);

    useEffect(() => {
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < TTL_MS) return;
        let cancelled = false;
        fetchOpenBills(key, accountId, side)
            .then((docs) => { if (!cancelled) setResult({ key, docs }); })
            .catch((e) => { if (!cancelled) setResult({ key, error: extractApiError(e, "Could not load open bills") }); });
        return () => { cancelled = true; };
    }, [accountId, side, key]);

    // Fresh answer for this key wins; otherwise a cached one (even if stale, while
    // the refresh is on its way); otherwise loading.
    const current = result?.key === key ? result : null;
    const docs: LinkableDoc[] | null = current?.docs ?? cache.get(key)?.docs ?? null;
    const error = current?.error ?? null;

    const totalOpen = (docs ?? []).reduce((s, d) => s + d.open, 0);

    return (
        <div className="rounded-md border border-border bg-card p-3 shadow-sm">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                Open bills{partyName ? ` — ${partyName}` : ""}
            </p>
            {error ? (
                <p className="mt-2 text-xs text-destructive">{error}</p>
            ) : docs === null ? (
                <div className="flex justify-center py-4">
                    <Loader2 className="animate-spin text-muted-foreground" size={16} />
                </div>
            ) : docs.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                    Nothing open. This {side === 1 ? "receipt" : "payment"} stays as an advance.
                </p>
            ) : (
                <>
                    <table className="mt-2 w-full text-xs">
                        <tbody>
                            {docs.map((d) => (
                                <tr
                                    key={d.universalVoucherId}
                                    className={`border-t border-border/50 ${onPickAmount ? "cursor-pointer hover:bg-muted/50" : ""}`}
                                    title={onPickAmount ? "Click to take this bill's open amount into the row" : undefined}
                                    onClick={() => onPickAmount?.(d.open)}
                                >
                                    <td className="py-1 pr-2">
                                        <span className="font-mono">{d.ref}</span>
                                        <span className="ml-1 text-muted-foreground">
                                            {new Date(d.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                                        </span>
                                    </td>
                                    <td className="py-1 text-right font-mono tabular-nums text-orange-600">{fmt(d.open)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="mt-1.5 flex justify-between border-t border-border pt-1.5 text-xs font-medium">
                        <span>Total open</span>
                        <span className="font-mono tabular-nums">₹ {fmt(totalOpen)}</span>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                        After Save, the link popup opens to place this {side === 1 ? "receipt" : "payment"} against these bills.
                    </p>
                </>
            )}
        </div>
    );
}

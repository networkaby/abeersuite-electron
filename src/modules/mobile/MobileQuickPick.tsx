"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Receipt, Search, Users } from "lucide-react";
import { usePartyList } from "@/shared/hooks/usePartySearch";
import { searchPartyRows } from "@/shared/lib/parties/partySearch";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { MOBILE_SETUP_FRESH_MS } from "@/shared/lib/constants/polling";
import MobileHeader from "./MobileHeader";
import { balanceLabel } from "./partyBalance";
import { usePartyBalances } from "./usePartyBalances";
import { useMobileResource } from "./useMobileResource";
import { mobileKey } from "./mobileCache";
import type { PaySetup } from "./types";

export type QuickKind = "pay" | "receive";

type Target = { type: "party" | "expense"; accountId: number; name: string; sub?: string | null };

const RECENT_MAX = 6;
const HITS = 15;

const COPY = {
    receive: { title: "Receive money", placeholder: "Who paid? Name or phone", none: "Your role cannot take receipts." },
    pay: { title: "Make payment", placeholder: "Pay whom? Party or expense", none: "Your role cannot make payments." },
};

/** The last few picked, per person and direction — the device's own convenience. */
function readRecent(key: string): Target[] {
    try {
        const v = JSON.parse(localStorage.getItem(key) ?? "[]") as Target[];
        return Array.isArray(v) ? v.slice(0, RECENT_MAX) : [];
    } catch { return []; }
}

/**
 * Quick Receive / Pay, step one: whom. Searches the party list already on the
 * device (the same forgiving search as every party box — no request per key);
 * Pay also lists the expense ledgers (rent, electricity, tea… from pay-setup).
 * The last few picked sit on top. A pick opens the ordinary Pay / Receive form,
 * which comes back here for the next entry.
 */
export default function MobileQuickPick({ kind, userId }: { kind: QuickKind; userId: string }) {
    const copy = COPY[kind];
    const router = useRouter();
    const [query, setQuery] = useState("");
    const recentKey = mobileKey(`recent:${kind}`, userId);
    const [recent, setRecent] = useState<Target[]>([]);
    useEffect(() => { setRecent(readRecent(recentKey)); }, [recentKey]);

    const { parties } = usePartyList();
    const setup = useMobileResource<PaySetup>("/api/mobile/pay-setup", "pay-setup", userId, { freshMs: MOBILE_SETUP_FRESH_MS });
    const permissions = (useSession().data?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const seeSuppliers = permissions.includes(PERMISSIONS.CUSTOMERS_VIEW_CREDITORS) || permissions.includes(PERMISSIONS.ADMIN_BYPASS);
    const allowed = kind === "pay" ? setup.data?.canPay : setup.data?.canReceive;

    const pool = useMemo(
        () => parties.filter((p) => p.accountId != null && (seeSuppliers || p.accountGroupType !== "LIABILITY")),
        [parties, seeSuppliers],
    );
    const q = query.trim();
    const partyHits: Target[] = useMemo(
        () => (q ? searchPartyRows(pool, q, { rows: HITS }).rows : []).map((p) => ({
            type: "party" as const, accountId: p.accountId!, name: p.name, sub: p.phones[0] ?? p.accountGroup,
        })),
        [pool, q],
    );
    const expenseHits: Target[] = useMemo(() => {
        if (kind !== "pay" || !q) return [];
        const words = q.toLowerCase().split(/\s+/);
        return (setup.data?.expenseLedgers ?? [])
            .filter((l) => words.every((w) => l.name.toLowerCase().includes(w)))
            .slice(0, HITS)
            .map((l) => ({ type: "expense" as const, accountId: l.id, name: l.name, sub: l.group }));
    }, [kind, q, setup.data]);

    const shownParties = q ? partyHits : recent.filter((r) => r.type === "party");
    const balances = usePartyBalances(shownParties.map((t) => t.accountId));

    const pick = (t: Target) => {
        const next = [t, ...recent.filter((r) => !(r.type === t.type && r.accountId === t.accountId))].slice(0, RECENT_MAX);
        try { localStorage.setItem(recentKey, JSON.stringify(next)); } catch { /* best-effort */ }
        router.push(t.type === "expense"
            ? `/m/quick/pay/expense/${t.accountId}`
            : `/m/parties/${t.accountId}/${kind}?from=/m/quick/${kind}`);
    };

    const row = (t: Target) => {
        const bal = t.type === "party" && balances[t.accountId] !== undefined ? balanceLabel(balances[t.accountId]) : null;
        const Icon = t.type === "expense" ? Receipt : Users;
        return (
            <li key={`${t.type}:${t.accountId}`}>
                <button type="button" onClick={() => pick(t)} className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-muted">
                    <Icon className="size-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{t.name}</span>
                        {t.sub && <span className="block truncate text-xs text-muted-foreground">{t.sub}</span>}
                    </span>
                    {bal && <span className={`shrink-0 text-sm font-semibold ${bal.tone}`}>{bal.text}</span>}
                </button>
            </li>
        );
    };

    return (
        <>
            <MobileHeader title={copy.title} back="/m" />
            {setup.data && !allowed ? (
                <p className="m-4 rounded-lg border p-4 text-sm text-muted-foreground">{copy.none}</p>
            ) : (
                <>
                    <div className="sticky top-[53px] z-10 bg-background px-3 py-2">
                        <label className="flex items-center gap-2 rounded-lg border px-3">
                            <Search className="size-4 text-muted-foreground" />
                            <input
                                type="search"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={copy.placeholder}
                                className="h-11 flex-1 bg-transparent outline-none"
                                autoComplete="off"
                                autoFocus
                            />
                        </label>
                    </div>

                    {!q && (recent.length > 0 ? (
                        <>
                            <p className="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent</p>
                            <ul className="divide-y">{recent.map(row)}</ul>
                        </>
                    ) : (
                        <p className="p-6 text-center text-sm text-muted-foreground">
                            Type a name or phone{kind === "pay" ? ", or an expense like rent or electricity" : ""}.
                        </p>
                    ))}

                    {q && expenseHits.length > 0 && (
                        <>
                            <p className="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Expenses</p>
                            <ul className="divide-y">{expenseHits.map(row)}</ul>
                        </>
                    )}
                    {q && partyHits.length > 0 && (
                        <>
                            {kind === "pay" && <p className="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Parties</p>}
                            <ul className="divide-y">{partyHits.map(row)}</ul>
                        </>
                    )}
                    {q && partyHits.length === 0 && expenseHits.length === 0 && (
                        <p className="p-6 text-center text-sm text-muted-foreground">Nothing found.</p>
                    )}
                </>
            )}
        </>
    );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { usePartyList } from "@/shared/hooks/usePartySearch";
import { browseParties, invalidateParties, type Party } from "@/shared/lib/parties/partyCatalog";
import { searchPartyRows } from "@/shared/lib/parties/partySearch";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import MobileListScreen from "./MobileListScreen";
import { balanceLabel } from "./partyBalance";
import { recheckPartyBalances, usePartyBalances } from "./usePartyBalances";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

const PAGE = 30;

/**
 * Party search over the party list the phone already holds — the same list and
 * the same forgiving search (typos, run-together words, any phone, keywords) as
 * every office party box, so typing costs no server read at all. Only the
 * balances of the rows on screen come from the server (usePartyBalances).
 *
 * Suppliers show only with "Show suppliers (creditors)", like the Contacts lists.
 */
export default function MobileParties() {
    const [query, setQuery] = useState("");
    const [limit, setLimit] = useState(PAGE);
    const { parties, loading } = usePartyList();
    const permissions = (useSession().data?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const seeSuppliers = permissions.includes(PERMISSIONS.CUSTOMERS_VIEW_CREDITORS) || permissions.includes(PERMISSIONS.ADMIN_BYPASS);

    const pool = useMemo(
        () => parties.filter((p) => p.accountId != null && (seeSuppliers || p.accountGroupType !== "LIABILITY")),
        [parties, seeSuppliers],
    );
    const { shown, more } = useMemo(() => {
        const q = query.trim();
        const rows: Party[] = q
            ? searchPartyRows(pool, q, { rows: limit + 1, fallback: false }).rows
            : browseParties(pool, { limit: limit + 1 });
        return { shown: rows.slice(0, limit), more: rows.length > limit };
    }, [pool, query, limit]);

    const balances = usePartyBalances(shown.map((p) => p.accountId!));

    return (
        <MobileListScreen
            title="Party"
            placeholder="Name, phone, area or keyword"
            query={query}
            onQuery={(q) => { setQuery(q); setLimit(PAGE); }}
            list={{
                loading,
                error: null,
                hasMore: more,
                empty: shown.length === 0,
                loadMore: () => setLimit((n) => n + PAGE),
                refresh: () => { recheckPartyBalances(); void invalidateParties(); },
            }}
            emptyText={loading ? "Loading parties…" : "No parties found."}
        >
            {shown.map((p) => {
                const balance = balances[p.accountId!];
                const bal = balance === undefined ? null : balanceLabel(balance);
                return (
                    <li key={`${p.type}:${p.id}`}>
                        <Link
                            href={`${PHONE_APP_HOME}/parties/${p.accountId}?name=${encodeURIComponent(p.name)}`}
                            className="flex items-start gap-3 px-3 py-3 active:bg-muted"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="font-medium leading-snug">{p.name}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                    {[p.phones[0], p.accountGroup === ACCOUNT_GROUPS.SUNDRY_DEBTORS ? null : p.accountGroup].filter(Boolean).join(" · ")}
                                </p>
                            </div>
                            <p className={`shrink-0 text-right text-sm font-semibold ${bal?.tone ?? "text-muted-foreground"}`}>
                                {bal?.text ?? "…"}
                            </p>
                        </Link>
                    </li>
                );
            })}
        </MobileListScreen>
    );
}

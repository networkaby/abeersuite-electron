"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import MobileHeader from "./MobileHeader";
import { useMobileList } from "./useMobileList";
import { balanceLabel } from "./partyBalance";

type Party = { accountId: number; name: string; group: string | null; phone: string | null; balance: number };

export default function MobileParties({ userId }: { userId: string }) {
    const [query, setQuery] = useState("");
    const list = useMobileList<Party>("/api/mobile/parties", query, userId);

    return (
        <>
            <MobileHeader title="Party balance" back="/m" onRefresh={list.refresh} busy={list.loading} />
            <div className="sticky top-[53px] z-10 bg-background px-3 py-2">
                <label className="flex items-center gap-2 rounded-lg border px-3">
                    <Search className="size-4 text-muted-foreground" />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Party name or phone"
                        className="h-11 flex-1 bg-transparent outline-none"
                        autoComplete="off"
                    />
                </label>
            </div>

            {list.error && <p className="px-3 text-sm text-destructive">{list.error}</p>}

            <ul className="divide-y">
                {list.items.map((p) => {
                    const bal = balanceLabel(p.balance);
                    return (
                        <li key={p.accountId}>
                            <Link
                                href={`/m/parties/${p.accountId}?name=${encodeURIComponent(p.name)}`}
                                className="flex items-start gap-3 px-3 py-3 active:bg-muted"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="font-medium leading-snug">{p.name}</p>
                                    <p className="text-xs text-muted-foreground">{[p.phone, p.group].filter(Boolean).join(" · ")}</p>
                                </div>
                                <p className={`shrink-0 text-right text-sm font-semibold ${bal.tone}`}>{bal.text}</p>
                            </Link>
                        </li>
                    );
                })}
            </ul>

            {!list.loading && list.items.length === 0 && !list.error && (
                <p className="p-6 text-center text-sm text-muted-foreground">No parties found.</p>
            )}
            {list.hasMore && (
                <button type="button" onClick={list.loadMore} disabled={list.loading} className="m-3 rounded-lg border py-3 text-sm">
                    {list.loading ? "Loading…" : "Load more"}
                </button>
            )}
        </>
    );
}

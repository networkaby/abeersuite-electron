"use client";

import { useState } from "react";
import Link from "next/link";
import MobileListScreen from "./MobileListScreen";
import { useMobileList } from "./useMobileList";
import { balanceLabel } from "./partyBalance";

type Party = { accountId: number; name: string; group: string | null; phone: string | null; balance: number };

export default function MobileParties({ userId }: { userId: string }) {
    const [query, setQuery] = useState("");
    const list = useMobileList<Party>("/api/mobile/parties", query, userId);

    return (
        <MobileListScreen
            title="Party balance"
            placeholder="Party name or phone"
            query={query}
            onQuery={setQuery}
            list={list}
            emptyText="No parties found."
        >
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
        </MobileListScreen>
    );
}

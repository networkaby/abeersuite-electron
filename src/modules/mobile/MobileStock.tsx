"use client";

import { useState } from "react";
import axios from "axios";
import { Search } from "lucide-react";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import MobileHeader from "./MobileHeader";
import { useMobileList } from "./useMobileList";

type Item = {
    id: number;
    sku: string | null;
    name: string;
    unit: string | null;
    stock: number | null;
    salePricePaise: number | null;
    mrpPaise: number | null;
};
type Split = { total: number; branches: { branchId: string; name: string; qty: number }[] };

const qty = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: 3 }));

export default function MobileStock({ userId }: { userId: string }) {
    const [query, setQuery] = useState("");
    const list = useMobileList<Item>("/api/mobile/stock", query, userId);
    const [open, setOpen] = useState<number | null>(null);
    const [splits, setSplits] = useState<Record<number, Split | string>>({});

    const toggle = async (id: number) => {
        const closing = open === id;
        setOpen(closing ? null : id);
        if (closing) return;
        try {
            const { data } = await axios.get<Split>(`/api/mobile/stock/${id}`);
            setSplits((was) => ({ ...was, [id]: data }));
        } catch (e) {
            setSplits((was) => (was[id] && typeof was[id] !== "string" ? was : { ...was, [id]: extractApiError(e, "Could not load branch stock") }));
        }
    };

    return (
        <>
            <MobileHeader title="Stock & price" back="/m" onRefresh={list.refresh} busy={list.loading} />
            <div className="sticky top-[53px] z-10 bg-background px-3 py-2">
                <label className="flex items-center gap-2 rounded-lg border px-3">
                    <Search className="size-4 text-muted-foreground" />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Product name, SKU or barcode"
                        className="h-11 flex-1 bg-transparent outline-none"
                        autoComplete="off"
                    />
                </label>
            </div>

            {list.error && <p className="px-3 text-sm text-destructive">{list.error}</p>}

            <ul className="divide-y">
                {list.items.map((p) => {
                    const split = splits[p.id];
                    const out = (p.stock ?? 0) <= 0;
                    return (
                        <li key={p.id}>
                            <button type="button" onClick={() => void toggle(p.id)} className="flex w-full items-start gap-3 px-3 py-3 text-left active:bg-muted">
                                <div className="min-w-0 flex-1">
                                    <p className="font-medium leading-snug">{p.name}</p>
                                    {p.sku && <p className="text-xs text-muted-foreground">{p.sku}</p>}
                                </div>
                                <div className="shrink-0 text-right">
                                    <p className="font-semibold">{p.salePricePaise == null ? "—" : formatRupeesFromPaise(p.salePricePaise)}</p>
                                    <p className={`text-sm ${out ? "text-destructive" : "text-muted-foreground"}`}>
                                        {qty(p.stock)} {p.unit ?? ""} in stock
                                    </p>
                                </div>
                            </button>
                            {open === p.id && (
                                <div className="bg-muted/40 px-3 pb-3 text-sm">
                                    {split == null ? (
                                        <p className="text-muted-foreground">Loading branches…</p>
                                    ) : typeof split === "string" ? (
                                        <p className="text-destructive">{split}</p>
                                    ) : split.branches.length === 0 ? (
                                        <p className="text-muted-foreground">No branch stock recorded.</p>
                                    ) : (
                                        <table className="w-full">
                                            <tbody>
                                                {split.branches.map((b) => (
                                                    <tr key={b.branchId}>
                                                        <td className="py-1">{b.name}</td>
                                                        <td className="py-1 text-right tabular-nums">{qty(b.qty)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                    {p.mrpPaise != null && <p className="mt-1 text-xs text-muted-foreground">MRP {formatRupeesFromPaise(p.mrpPaise)}</p>}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>

            {!list.loading && list.items.length === 0 && !list.error && (
                <p className="p-6 text-center text-sm text-muted-foreground">No products found.</p>
            )}
            {list.hasMore && (
                <button type="button" onClick={list.loadMore} disabled={list.loading} className="m-3 rounded-lg border py-3 text-sm">
                    {list.loading ? "Loading…" : "Load more"}
                </button>
            )}
        </>
    );
}

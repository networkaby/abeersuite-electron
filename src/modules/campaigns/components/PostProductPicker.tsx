"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { cloudinaryThumb } from "@/shared/lib/cloudinaryImage";
import type { PostProduct } from "@/modules/campaigns/lib/post";

/** Rows shown at once — beyond this staff narrow it by typing. */
const MAX_ROWS = 60;

// One read per page: the list only changes when the shop's does (5-minute cache server side).
let listOnce: Promise<PostProduct[]> | null = null;
export function loadPostProducts(): Promise<PostProduct[]> {
    listOnce ??= axios
        .get<{ products: PostProduct[] }>("/api/campaigns/posts/products")
        .then((r) => r.data.products)
        .catch((e) => {
            listOnce = null;
            throw e;
        });
    return listOnce;
}

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/** Pick one of the products the shop shows customers, to start a post from. */
export default function PostProductPicker({
    open,
    onOpenChange,
    onPick,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPick: (p: PostProduct) => void;
}) {
    const [products, setProducts] = useState<PostProduct[] | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const [query, setQuery] = useState("");

    useEffect(() => {
        if (!open || products) return;
        loadPostProducts()
            .then(setProducts)
            .catch((e) => setFailed(extractApiError(e, "Failed to load the shop products")));
    }, [open, products]);

    const rows = useMemo(() => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const all = products ?? [];
        const hits = words.length ? all.filter((p) => words.every((w) => `${p.name} ${p.category}`.toLowerCase().includes(w))) : all;
        return hits.slice(0, MAX_ROWS);
    }, [products, query]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Post from a shop product</DialogTitle>
                </DialogHeader>
                <Input autoFocus value={query} placeholder="Search by name or category…" onChange={(e) => setQuery(e.target.value)} />
                <div className="h-[60vh] overflow-y-auto">
                    {failed ? (
                        <p className="py-10 text-center text-sm text-destructive">{failed}</p>
                    ) : !products ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">Loading the shop…</p>
                    ) : rows.length === 0 ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">No product on the shop matches.</p>
                    ) : (
                        <ul className="divide-y">
                            {rows.map((p) => (
                                <li key={p.id}>
                                    <button type="button" className="flex w-full items-center gap-3 px-1 py-2 text-left hover:bg-muted/50" onClick={() => onPick(p)}>
                                        {p.imageUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={cloudinaryThumb(p.imageUrl, 96, "square")} alt="" className="size-12 shrink-0 rounded border object-cover" />
                                        ) : (
                                            <span className="size-12 shrink-0 rounded border bg-muted" />
                                        )}
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium">{p.name}</span>
                                            <span className="block text-xs text-muted-foreground">
                                                {p.category} · {rupees(p.pricePaise)}
                                                {p.inStock ? "" : " · not in stock"}
                                                {p.imageUrl ? "" : " · no photo"}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

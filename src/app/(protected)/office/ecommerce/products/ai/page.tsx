"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { extractApiError } from "@/shared/lib/api";
import { AI_BULK_BATCH_SIZE } from "@/shared/lib/constants";
import { fetchAiCopy, type ProductCopy } from "@/modules/ecommerce/lib/aiCopyClient";
import { AiDraftNotes, mergeAiSpecs } from "@/modules/ecommerce/components/AiCopyPanel";

// Bulk AI copy for products with no shop description (the one-time backlog,
// then each month's new items). Runs a few at a time, keeps each draft on
// screen, and writes nothing until staff press Save on a row or Save all.

type Item = {
    id: number;
    sku: string;
    name: string;
    imageUrl: string | null;
    brand: string | null;
    subheading: string | null;
    specs: Record<string, string>;
};
type Row = Item & { draft?: ProductCopy; error?: string; saved?: boolean };
type Page = { total: number; items: Item[]; nextCursor: number | null };

export default function AiBulkCopyPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [total, setTotal] = useState(0);
    const [cursor, setCursor] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [search, setSearch] = useState(false); // off by default — see AiCopyPanel
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({ done: 0, of: 0 });

    const load = useCallback(async (after: number | null) => {
        setLoading(true);
        try {
            const { data } = await axios.get<Page>("/api/ecommerce/products/ai-copy", {
                params: { take: 50, ...(after ? { cursor: after } : {}) },
            });
            setTotal(data.total);
            setCursor(data.nextCursor);
            setRows((prev) => (after ? [...prev, ...data.items] : data.items));
        } catch (e) {
            toast.error(extractApiError(e, "Could not load products"));
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { void load(null); }, [load]);

    const patchRow = (id: number, patch: Partial<Row>) =>
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    const generate = async () => {
        const todo = rows.filter((r) => selected.has(r.id) && !r.saved);
        if (!todo.length) { toast.error("Tick the products to write"); return; }
        setRunning(true);
        setProgress({ done: 0, of: todo.length });
        // 503 = the key itself is out (credit / limit / not set up) — every
        // further product would fail the same way, so stop and say why once.
        let stopped: string | null = null;
        for (let i = 0; i < todo.length && !stopped; i += AI_BULK_BATCH_SIZE) {
            await Promise.all(todo.slice(i, i + AI_BULK_BATCH_SIZE).map(async (r) => {
                try {
                    const draft = await fetchAiCopy({ productId: r.id, search });
                    patchRow(r.id, { draft, error: undefined });
                } catch (e) {
                    const msg = extractApiError(e, "AI failed");
                    if (axios.isAxiosError(e) && e.response?.status === 503) stopped = msg;
                    patchRow(r.id, { error: msg });
                } finally {
                    setProgress((p) => ({ ...p, done: p.done + 1 }));
                }
            }));
        }
        setRunning(false);
        if (stopped) toast.error(`Stopped: ${stopped}`);
    };

    const save = async (r: Row) => {
        if (!r.draft) return;
        const specs = Object.fromEntries(
            mergeAiSpecs(Object.entries(r.specs).map(([k, v]) => ({ k, v })), r.draft.specs)
                .filter((x) => x.k.trim())
                .map((x) => [x.k, x.v]),
        );
        try {
            await axios.patch(`/api/ecommerce/products/${r.id}`, {
                shopDescription: r.draft.shopDescription,
                // Staff-typed online name wins; the AI's SEO title fills a blank
                // one, or one that is only a copy of the stock name.
                ...(r.subheading?.trim() && r.subheading.trim() !== r.name.trim() ? {} : { shopSubheading: r.draft.title }),
                specs,
            });
            patchRow(r.id, { saved: true });
            setSelected((s) => { const n = new Set(s); n.delete(r.id); return n; });
        } catch (e) {
            patchRow(r.id, { error: extractApiError(e, "Save failed") });
        }
    };

    const saveAll = async () => {
        const ready = rows.filter((r) => r.draft && !r.saved);
        for (const r of ready) await save(r);
        toast.success(`Saved ${ready.length} product${ready.length === 1 ? "" : "s"}`);
    };

    const open = rows.filter((r) => !r.saved);
    const allTicked = open.length > 0 && open.every((r) => selected.has(r.id));
    const draftsReady = rows.filter((r) => r.draft && !r.saved).length;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <Link href="/office/ecommerce/products" className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline">
                        <ArrowLeft className="size-4" /> Products
                    </Link>
                    <h1 className="text-2xl font-semibold tracking-tight">Write descriptions with AI</h1>
                    <p className="text-muted-foreground text-sm">
                        {loading && rows.length === 0
                            ? "Loading…"
                            : `${total} active product${total === 1 ? "" : "s"} have no description. Tick, generate, check the draft, then save.`}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <Switch id="bulk-search" checked={search} onCheckedChange={setSearch} />
                        <Label htmlFor="bulk-search" className="text-sm">Search online when it helps</Label>
                    </div>
                    <Button onClick={() => void generate()} disabled={running || selected.size === 0}>
                        <Sparkles className="size-4" />
                        {running ? `Writing ${progress.done}/${progress.of}…` : `Generate ${selected.size || ""}`.trim()}
                    </Button>
                    <Button variant="outline" onClick={() => void saveAll()} disabled={running || draftsReady === 0}>
                        Save all drafts ({draftsReady})
                    </Button>
                </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
                <Checkbox
                    checked={allTicked}
                    onCheckedChange={(v) => setSelected(v ? new Set(open.map((r) => r.id)) : new Set())}
                />
                Tick all loaded ({open.length})
            </label>

            <div className="divide-y divide-border rounded-md border border-border">
                {rows.map((r) => (
                    <div key={r.id} className={`flex gap-3 p-3 ${r.saved ? "opacity-50" : ""}`}>
                        <Checkbox
                            className="mt-1"
                            disabled={r.saved}
                            checked={selected.has(r.id)}
                            onCheckedChange={(v) => setSelected((s) => {
                                const n = new Set(s);
                                if (v) n.add(r.id); else n.delete(r.id);
                                return n;
                            })}
                        />
                        {r.imageUrl
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={r.imageUrl} alt="" className="size-14 shrink-0 rounded object-cover" />
                            : <div className="bg-muted size-14 shrink-0 rounded" />}
                        <div className="min-w-0 flex-1 space-y-1 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <Link href={`/office/ecommerce/products/${r.id}`} className="font-medium hover:underline">
                                    {r.name}
                                </Link>
                                <span className="text-muted-foreground font-mono text-xs">{r.sku}</span>
                            </div>
                            {!r.imageUrl && <p className="text-muted-foreground text-xs">No photo — AI works from the name only.</p>}
                            {r.error && <p className="text-destructive text-xs">{r.error}</p>}
                            {r.saved && <p className="text-xs text-green-600">Saved</p>}
                            {r.draft && !r.saved && (
                                <div className="bg-muted/40 space-y-1 rounded-md p-2">
                                    <p className="font-medium">{r.draft.title}</p>
                                    <p className="whitespace-pre-line">{r.draft.shopDescription}</p>
                                    {Object.keys(r.draft.specs).length > 0 && (
                                        <p className="text-muted-foreground text-xs">
                                            {Object.entries(r.draft.specs).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                                        </p>
                                    )}
                                    {r.draft.sources.length > 0 && (
                                        <p className="text-xs">
                                            {r.draft.sources.slice(0, 3).map((s) => (
                                                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-primary mr-3 hover:underline">
                                                    {s.title}
                                                </a>
                                            ))}
                                        </p>
                                    )}
                                    <AiDraftNotes draft={r.draft} />
                                    <Button size="sm" onClick={() => void save(r)}>Save</Button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {!loading && rows.length === 0 && (
                    <p className="text-muted-foreground p-6 text-center text-sm">Every active product has a description.</p>
                )}
            </div>
            {cursor && (
                <Button variant="outline" disabled={loading} onClick={() => void load(cursor)}>
                    {loading ? "Loading…" : "Load more"}
                </Button>
            )}
        </div>
    );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2, Search, Trash2, User, Building2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/shared/lib/format/utils";

type Direction = "personToCompany" | "companyToPerson";

type SearchHit = { id: number; name: string; phone: string | null };

type Preview = {
    direction: Direction;
    sourceId: number;
    sourceName: string;
    accountId: number | null;
    mappableFields: string[];
    lostFields: string[];
    counts: {
        phones: number;
        emails: number;
        crmLeads: number;
        personCompanyLinks: number;
        shopOrders: number;
        portalCredential: boolean;
    };
    blockers: Array<{ kind: string; targetId?: number; count?: number }>;
};

type Tombstone = {
    id: number;
    type: "person" | "company";
    name: string;
    convertedAt: string;
    target: { id: number; name: string; type: "person" | "company" } | null;
};

export function CustomerToolsPanel({ canHardDelete }: { canHardDelete: boolean }) {
    return (
        <div className="space-y-8">
            <ConvertSection />
            <MergeSection />
            {canHardDelete ? <TrashSection /> : null}
        </div>
    );
}

// ── Convert ──────────────────────────────────────────────────────────────────

function ConvertSection() {
    const router = useRouter();
    const [direction, setDirection] = useState<Direction>("personToCompany");
    const [query, setQuery] = useState("");
    const [hits, setHits] = useState<SearchHit[]>([]);
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState<SearchHit | null>(null);
    const [preview, setPreview] = useState<Preview | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [converting, setConverting] = useState(false);

    const sourceLabel = direction === "personToCompany" ? "Person" : "Company";
    const targetLabel = direction === "personToCompany" ? "Company" : "Person";

    useEffect(() => {
        setSelected(null);
        setPreview(null);
        setHits([]);
        setQuery("");
    }, [direction]);

    useEffect(() => {
        if (query.trim().length < 2) {
            setHits([]);
            return;
        }
        let cancelled = false;
        const handle = setTimeout(async () => {
            setSearching(true);
            try {
                const url = direction === "personToCompany"
                    ? `/api/person?q=${encodeURIComponent(query.trim())}`
                    : `/api/companies?q=${encodeURIComponent(query.trim())}`;
                const { data } = await axios.get(url);
                if (cancelled) return;
                const rows: SearchHit[] = (Array.isArray(data) ? data : []).map((row: { id: number; name: string; phone?: string | null }) => ({
                    id: row.id,
                    name: row.name,
                    phone: row.phone ?? null,
                }));
                setHits(rows.slice(0, 10));
            } catch {
                if (!cancelled) setHits([]);
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 250);
        return () => { cancelled = true; clearTimeout(handle); };
    }, [query, direction]);

    async function pick(hit: SearchHit) {
        setSelected(hit);
        setHits([]);
        setQuery(hit.name);
        setLoadingPreview(true);
        setPreview(null);
        try {
            const { data } = await axios.get<Preview>(
                `/api/customer-tools/convert/preview?direction=${direction}&sourceId=${hit.id}`,
            );
            setPreview(data);
        } catch (err) {
            toast.error("Failed to load preview");
            console.error(err);
        } finally {
            setLoadingPreview(false);
        }
    }

    async function confirm() {
        if (!preview || preview.blockers.length > 0) return;
        setConverting(true);
        try {
            const { data } = await axios.post("/api/customer-tools/convert", {
                direction,
                sourceId: preview.sourceId,
            });
            toast.success(`Converted ${preview.sourceName} to ${data.newType} #${data.newId}`);
            // The Account survives the conversion (its id is reused), and
            // /office/customers/[accountId] redirects to the all-customers
            // view with the right side selected (?personId or ?companyId).
            const target = data.accountId
                ? `/office/customers/${data.accountId}`
                : data.newType === "company"
                    ? `/office/customers/all?companyId=${data.newId}`
                    : `/office/customers/all?personId=${data.newId}`;
            router.push(target);
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data?.error ?? "Conversion failed")
                : "Conversion failed";
            toast.error(msg);
        } finally {
            setConverting(false);
        }
    }

    const blocked = preview != null && preview.blockers.length > 0;

    return (
        <section className="rounded-lg border bg-card p-5">
            <div className="flex items-center gap-2">
                <ArrowRightLeft className="size-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">Convert Person ↔ Company</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
                Keeps the same ledger account (Account.id stays the same) so every voucher, journal line,
                ticket and device that referenced the source party continues to work.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                    <Label className="text-xs uppercase text-muted-foreground">Direction</Label>
                    <div className="mt-1 flex rounded-md border p-1">
                        <button
                            type="button"
                            onClick={() => setDirection("personToCompany")}
                            className={cn(
                                "flex-1 rounded px-3 py-1.5 text-sm transition",
                                direction === "personToCompany" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                            )}
                        >
                            <User className="mr-1 inline size-3.5" /> Person → Company
                        </button>
                        <button
                            type="button"
                            onClick={() => setDirection("companyToPerson")}
                            className={cn(
                                "flex-1 rounded px-3 py-1.5 text-sm transition",
                                direction === "companyToPerson" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                            )}
                        >
                            <Building2 className="mr-1 inline size-3.5" /> Company → Person
                        </button>
                    </div>
                </div>

                <div className="relative">
                    <Label className="text-xs uppercase text-muted-foreground">Source {sourceLabel}</Label>
                    <div className="relative mt-1">
                        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={query}
                            onChange={(e) => { setQuery(e.target.value); setSelected(null); setPreview(null); }}
                            placeholder={`Search ${sourceLabel.toLowerCase()} by name or phone…`}
                            className="pl-8"
                        />
                        {searching ? (
                            <Loader2 className="absolute right-2 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                        ) : null}
                    </div>
                    {hits.length > 0 ? (
                        <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow">
                            {hits.map((hit) => (
                                <button
                                    key={hit.id}
                                    type="button"
                                    onClick={() => pick(hit)}
                                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                                >
                                    <div className="font-medium">{hit.name}</div>
                                    {hit.phone ? <div className="text-xs text-muted-foreground">{hit.phone}</div> : null}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>

            {loadingPreview ? (
                <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading preview…
                </div>
            ) : null}

            {preview && !loadingPreview ? (
                <div className="mt-6 space-y-4 rounded-md border bg-muted/30 p-4">
                    <div>
                        <div className="text-xs uppercase text-muted-foreground">Source</div>
                        <div className="font-medium">{preview.sourceName} (#{preview.sourceId})</div>
                        <div className="text-xs text-muted-foreground">
                            Account: {preview.accountId ?? "—"} (preserved on the new {targetLabel.toLowerCase()})
                        </div>
                    </div>

                    {preview.blockers.length > 0 ? (
                        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200">
                            <div className="flex items-center gap-1 font-medium"><AlertTriangle className="size-4" /> Cannot convert</div>
                            <ul className="mt-1 list-disc pl-5">
                                {preview.blockers.map((b, i) => (
                                    <li key={i}>{describeBlocker(b)}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}

                    <div className="grid gap-2 text-sm md:grid-cols-2">
                        <div>
                            <div className="text-xs uppercase text-muted-foreground">Will move</div>
                            <ul className="mt-1 space-y-0.5">
                                <li>Phones: <strong>{preview.counts.phones}</strong></li>
                                <li>Emails: <strong>{preview.counts.emails}</strong></li>
                                <li>CRM leads: <strong>{preview.counts.crmLeads}</strong> (re-pointed)</li>
                                <li>Shop orders (terminal): <strong>{preview.counts.shopOrders}</strong> (personId detached, accountId kept)</li>
                            </ul>
                        </div>
                        <div>
                            <div className="text-xs uppercase text-muted-foreground">Will drop</div>
                            <ul className="mt-1 space-y-0.5">
                                <li>PersonCompany links: <strong>{preview.counts.personCompanyLinks}</strong></li>
                                <li>Portal credential: <strong>{preview.counts.portalCredential ? "yes" : "none"}</strong></li>
                                <li>Lost fields: <span className="text-muted-foreground">{preview.lostFields.length > 0 ? preview.lostFields.join(", ") : "—"}</span></li>
                            </ul>
                        </div>
                    </div>

                    <div className="text-xs text-muted-foreground">
                        Mappable fields: {preview.mappableFields.join(", ")}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button onClick={confirm} disabled={blocked || converting}>
                            {converting ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                            Convert to {targetLabel}
                        </Button>
                        <Button variant="ghost" onClick={() => { setSelected(null); setPreview(null); setQuery(""); }}>
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : null}

            {/* selected is reset on cancel; suppress unused-var lint */}
            <span className="hidden">{selected?.id}</span>
        </section>
    );
}

function describeBlocker(b: { kind: string; targetId?: number; count?: number }): string {
    switch (b.kind) {
        case "notFound": return "Source record not found.";
        case "alreadyInactive": return "Source is already inactive — possibly already converted or deleted.";
        case "alreadyConverted": return `Source was already converted (target id #${b.targetId}).`;
        case "noAccount": return "Source has no ledger Account — fix the data layer first.";
        case "openShopOrders": return `${b.count} open shop order(s) — only terminal orders (DELIVERED / REFUNDED / CANCELLED) can carry over.`;
        default: return b.kind;
    }
}

// ── Merge (placeholder) ──────────────────────────────────────────────────────

function MergeSection() {
    return (
        <section className="rounded-lg border border-dashed bg-muted/30 p-5">
            <h2 className="text-base font-semibold">Merge duplicate customers</h2>
            <p className="mt-1 text-sm text-muted-foreground">
                Coming soon — merge two duplicate Person or Company records (e.g. the same physical customer created
                twice with different phone numbers) into one, keeping all history.
            </p>
        </section>
    );
}

// ── Trash ────────────────────────────────────────────────────────────────────

function TrashSection() {
    const [rows, setRows] = useState<Tombstone[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        try {
            const { data } = await axios.get<Tombstone[]>("/api/customer-tools/trash");
            setRows(data);
        } catch {
            toast.error("Failed to load trash");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { void load(); }, []);

    async function hardDelete(row: Tombstone) {
        const key = `${row.type}:${row.id}`;
        if (!confirm(`Permanently delete ${row.type} #${row.id} (${row.name})? This cannot be undone.`)) return;
        setDeletingId(key);
        try {
            await axios.delete(`/api/customer-tools/trash/${row.type}/${row.id}`);
            toast.success(`Hard-deleted ${row.type} #${row.id}`);
            await load();
        } catch (err) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data?.error ?? "Hard-delete failed")
                : "Hard-delete failed";
            toast.error(msg);
        } finally {
            setDeletingId(null);
        }
    }

    const now = useMemo(() => Date.now(), [rows]);

    return (
        <section className="rounded-lg border bg-card p-5">
            <div className="flex items-center gap-2">
                <Trash2 className="size-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">Trash (converted records)</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
                Soft-deleted tombstones from previous conversions. Hard-delete removes them permanently — the audit
                back-link from the active partner will dangle silently after.
            </p>

            {loading ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading…
                </div>
            ) : !rows || rows.length === 0 ? (
                <div className="mt-4 text-sm text-muted-foreground">No converted records.</div>
            ) : (
                <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-left text-xs uppercase text-muted-foreground">
                            <tr>
                                <th className="py-2">Source</th>
                                <th className="py-2">Type</th>
                                <th className="py-2">Converted to</th>
                                <th className="py-2">Age</th>
                                <th className="py-2 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => {
                                const key = `${row.type}:${row.id}`;
                                const age = ageString(new Date(row.convertedAt).getTime(), now);
                                const targetHref = row.target
                                    ? row.target.type === "company"
                                        ? `/office/customers/all?companyId=${row.target.id}`
                                        : `/office/customers/all?personId=${row.target.id}`
                                    : null;
                                return (
                                    <tr key={key} className="border-t">
                                        <td className="py-2">
                                            <div className="font-medium">{row.name}</div>
                                            <div className="text-xs text-muted-foreground">#{row.id}</div>
                                        </td>
                                        <td className="py-2"><Badge variant="outline">{row.type}</Badge></td>
                                        <td className="py-2">
                                            {row.target && targetHref ? (
                                                <a href={targetHref} className="text-primary hover:underline">
                                                    {row.target.type} #{row.target.id} — {row.target.name}
                                                </a>
                                            ) : "—"}
                                        </td>
                                        <td className="py-2 text-muted-foreground">{age}</td>
                                        <td className="py-2 text-right">
                                            <Button
                                                size="sm"
                                                variant="destructive"
                                                onClick={() => hardDelete(row)}
                                                disabled={deletingId === key}
                                            >
                                                {deletingId === key ? (
                                                    <Loader2 className="size-3.5 animate-spin" />
                                                ) : (
                                                    <Trash2 className="size-3.5" />
                                                )}
                                                <span className="ml-1">Hard-delete</span>
                                            </Button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

function ageString(thenMs: number, nowMs: number): string {
    const diff = Math.max(0, nowMs - thenMs);
    const day = 1000 * 60 * 60 * 24;
    const days = Math.floor(diff / day);
    if (days >= 1) return `${days} day${days === 1 ? "" : "s"} ago`;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const mins = Math.floor(diff / (1000 * 60));
    return `${mins} min${mins === 1 ? "" : "s"} ago`;
}

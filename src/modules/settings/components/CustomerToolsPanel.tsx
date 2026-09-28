"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2, Search, User, Building2, AlertTriangle, Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/shared/lib/format/utils";
import type {
    ConvertPreview as Preview,
    MergePreview,
    MergeKind,
} from "@/modules/customer/lib/convertParty";

type Direction = "personToCompany" | "companyToPerson";

type SearchHit = { id: number; name: string; phone: string | null };

export function CustomerToolsPanel() {
    return (
        <div className="space-y-8">
            <ConvertSection />
            <MergeSection />
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
            toast.error(extractApiError(err, "Conversion failed"));
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
                ticket and device that referenced the source party continues to work. Contacts, deals, help
                tickets, CRM notes and bill references move across, and the old record is removed for good.
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
                                <li>Deals: <strong>{preview.counts.deals}</strong></li>
                                <li>Help tickets: <strong>{preview.counts.helpTickets}</strong></li>
                                <li>CRM notes: <strong>{preview.counts.timelineLogs}</strong></li>
                                <li>Bills re-pointed: <strong>{preview.counts.vouchers}</strong></li>
                                <li>Shop orders (terminal): <strong>{preview.counts.shopOrders}</strong> (personId detached, accountId kept)</li>
                            </ul>
                        </div>
                        <div>
                            <div className="text-xs uppercase text-muted-foreground">Will drop</div>
                            <ul className="mt-1 space-y-0.5">
                                <li>PersonCompany links: <strong>{preview.counts.personCompanyLinks}</strong></li>
                                <li>Portal credential: <strong>{preview.counts.portalCredential ? "yes" : "none"}</strong></li>
                                <li>Social profile: <strong>{preview.counts.socialProfile ? "yes" : "none"}</strong></li>
                                <li>Lost fields: <span className="text-muted-foreground">{preview.lostFields.length > 0 ? preview.lostFields.join(", ") : "—"}</span></li>
                                <li>The source {sourceLabel.toLowerCase()} record itself (deleted for good)</li>
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

function describeBlocker(b: Preview["blockers"][number]): string {
    switch (b.kind) {
        case "notFound": return "Source record not found.";
        case "alreadyInactive": return "Source is already inactive — reactivate it first.";
        case "noAccount": return "Source has no ledger Account — fix the data layer first.";
        case "openShopOrders": return `${b.count} open shop order(s) — only terminal orders (DELIVERED / REFUNDED / CANCELLED) can carry over.`;
        // Every kind is named above; this only shows an API newer than this page.
        default: return (b as { kind: string }).kind;
    }
}

// ── Merge ────────────────────────────────────────────────────────────────────

function MergeSection() {
    const router = useRouter();
    const [kind, setKind] = useState<MergeKind>("person");
    const [winner, setWinner] = useState<SearchHit | null>(null);
    const [loser, setLoser] = useState<SearchHit | null>(null);
    const [preview, setPreview] = useState<MergePreview | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [merging, setMerging] = useState(false);

    useEffect(() => {
        setWinner(null);
        setLoser(null);
        setPreview(null);
    }, [kind]);

    useEffect(() => {
        if (!winner || !loser || winner.id === loser.id) { setPreview(null); return; }
        let cancelled = false;
        setLoadingPreview(true);
        (async () => {
            try {
                const { data } = await axios.get<MergePreview>(
                    `/api/customer-tools/merge/preview?kind=${kind}&winnerId=${winner.id}&loserId=${loser.id}`,
                );
                if (!cancelled) setPreview(data);
            } catch {
                if (!cancelled) toast.error("Failed to load merge preview");
            } finally {
                if (!cancelled) setLoadingPreview(false);
            }
        })();
        return () => { cancelled = true; };
    }, [kind, winner, loser]);

    async function confirm() {
        if (!preview || preview.blockers.length > 0 || !winner || !loser) return;
        setMerging(true);
        try {
            const { data } = await axios.post("/api/customer-tools/merge", {
                kind, winnerId: winner.id, loserId: loser.id,
            });
            toast.success(`Merged ${loser.name} → ${winner.name}`);
            const target = data.winnerAccountId ? `/office/customers/${data.winnerAccountId}` : "/office/customers/all";
            router.push(target);
        } catch (err) {
            toast.error(extractApiError(err, "Merge failed"));
        } finally {
            setMerging(false);
        }
    }

    const sourceLabel = kind === "person" ? "Person" : "Company";

    return (
        <section className="rounded-lg border bg-card p-5">
            <div className="flex items-center gap-2">
                <Merge className="size-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">Merge duplicate customers</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
                Pick the row to <strong>keep</strong> (winner) and the duplicate to <strong>merge in</strong> (loser).
                Every voucher, journal line, ticket, device, contact, deal, help ticket and CRM note on the loser moves
                onto the winner; the loser&apos;s Account is dissolved into the winner&apos;s and the loser record is
                removed for good.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div>
                    <Label className="text-xs uppercase text-muted-foreground">Type</Label>
                    <div className="mt-1 flex rounded-md border p-1">
                        <button
                            type="button"
                            onClick={() => setKind("person")}
                            className={cn("flex-1 rounded px-3 py-1.5 text-sm transition",
                                kind === "person" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                        >
                            <User className="mr-1 inline size-3.5" /> Person
                        </button>
                        <button
                            type="button"
                            onClick={() => setKind("company")}
                            className={cn("flex-1 rounded px-3 py-1.5 text-sm transition",
                                kind === "company" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                        >
                            <Building2 className="mr-1 inline size-3.5" /> Company
                        </button>
                    </div>
                </div>
                <PartyPicker
                    label={`Keep (winner ${sourceLabel.toLowerCase()})`}
                    kind={kind}
                    excludeId={loser?.id ?? null}
                    selected={winner}
                    onSelect={(h) => { setWinner(h); setPreview(null); }}
                />
                <PartyPicker
                    label={`Merge in (loser ${sourceLabel.toLowerCase()})`}
                    kind={kind}
                    excludeId={winner?.id ?? null}
                    selected={loser}
                    onSelect={(h) => { setLoser(h); setPreview(null); }}
                />
            </div>

            {loadingPreview ? (
                <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading preview…
                </div>
            ) : null}

            {preview && !loadingPreview ? (
                <div className="mt-6 space-y-4 rounded-md border bg-muted/30 p-4">
                    <div className="grid gap-3 text-sm md:grid-cols-2">
                        <div>
                            <div className="text-xs uppercase text-muted-foreground">Winner (keep)</div>
                            <div className="font-medium">{preview.winnerName} (#{preview.winnerId})</div>
                            <div className="text-xs text-muted-foreground">Account: {preview.winnerAccountId ?? "—"}</div>
                        </div>
                        <div>
                            <div className="text-xs uppercase text-muted-foreground">Loser (will be deleted)</div>
                            <div className="font-medium">{preview.loserName} (#{preview.loserId})</div>
                            <div className="text-xs text-muted-foreground">Account: {preview.loserAccountId ?? "—"} (will be deleted)</div>
                        </div>
                    </div>

                    {preview.blockers.length > 0 ? (
                        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200">
                            <div className="flex items-center gap-1 font-medium"><AlertTriangle className="size-4" /> Cannot merge</div>
                            <ul className="mt-1 list-disc pl-5">
                                {preview.blockers.map((b, i) => (<li key={i}>{describeMergeBlocker(b)}</li>))}
                            </ul>
                        </div>
                    ) : null}

                    <div className="grid gap-2 text-sm md:grid-cols-2">
                        <div>
                            <div className="text-xs uppercase text-muted-foreground">Ledger rows moving (loser Account → winner Account)</div>
                            <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                                <li>Vouchers (party): <strong>{preview.accountRefs.voucherParty}</strong></li>
                                <li>Ledger lines: <strong>{preview.accountRefs.voucherGlLines}</strong></li>
                                <li>Charges: <strong>{preview.accountRefs.invVoucherCharges}</strong></li>
                                <li>Tenders: <strong>{preview.accountRefs.invVoucherTenders}</strong></li>
                                <li>Tickets: <strong>{preview.accountRefs.tickets}</strong></li>
                                <li>Devices: <strong>{preview.accountRefs.devices}</strong></li>
                            </ul>
                        </div>
                        <div>
                            <div className="text-xs uppercase text-muted-foreground">Everything naming the loser moves to the winner</div>
                            <ul className="mt-1 space-y-0.5">
                                <li>Phones: <strong>{preview.partyRefs.phones}</strong></li>
                                <li>Emails: <strong>{preview.partyRefs.emails}</strong></li>
                                <li>Deals: <strong>{preview.partyRefs.deals}</strong></li>
                                <li>Help tickets: <strong>{preview.partyRefs.helpTickets}</strong></li>
                                <li>CRM notes: <strong>{preview.partyRefs.timelineLogs}</strong></li>
                                <li>Bills re-pointed: <strong>{preview.partyRefs.vouchers}</strong></li>
                                <li>PersonCompany links: <strong>{preview.partyRefs.personCompanyLinks}</strong></li>
                                {kind === "person" ? (
                                    <li>Shop orders: <strong>{preview.partyRefs.shopOrders}</strong></li>
                                ) : null}
                                {kind === "person" ? (
                                    <li>Portal login on loser: <strong>{preview.partyRefs.portalCredential ? "yes — will be dropped" : "none"}</strong></li>
                                ) : null}
                                {kind === "person" ? (
                                    <li>Social profile on loser: <strong>{preview.partyRefs.socialProfile ? "yes — will be dropped" : "none"}</strong></li>
                                ) : null}
                                <li>The loser {sourceLabel.toLowerCase()} record itself (deleted for good)</li>
                            </ul>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button onClick={confirm} disabled={preview.blockers.length > 0 || merging}>
                            {merging ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                            Merge into winner
                        </Button>
                        <Button variant="ghost" onClick={() => { setWinner(null); setLoser(null); setPreview(null); }}>
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : null}
        </section>
    );
}

function describeMergeBlocker(b: MergePreview["blockers"][number]): string {
    switch (b.kind) {
        case "notFound": return `Source not found (${b.side}).`;
        case "sameId": return "Winner and loser must be different rows.";
        case "sourceInactive": return `${b.side} is inactive.`;
        case "noAccount": return `${b.side} has no ledger Account.`;
        case "accountIsTillOrVault": return `Loser's Account is wired into POS / Branch (${b.usage}). Un-wire first.`;
        case "accountIsParent": return `Loser's Account is the parent of ${b.childCount} other account(s).`;
    }
}

/** Inline picker that searches /api/person or /api/companies by query. */
function PartyPicker({
    label, kind, excludeId, selected, onSelect,
}: {
    label: string;
    kind: MergeKind;
    excludeId: number | null;
    selected: SearchHit | null;
    onSelect: (hit: SearchHit | null) => void;
}) {
    const [query, setQuery] = useState("");
    const [hits, setHits] = useState<SearchHit[]>([]);
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        if (selected) { setHits([]); return; }
        if (query.trim().length < 2) { setHits([]); return; }
        let cancelled = false;
        const handle = setTimeout(async () => {
            setSearching(true);
            try {
                const url = kind === "person"
                    ? `/api/person?q=${encodeURIComponent(query.trim())}`
                    : `/api/companies?q=${encodeURIComponent(query.trim())}`;
                const { data } = await axios.get(url);
                if (cancelled) return;
                const rows: SearchHit[] = (Array.isArray(data) ? data : [])
                    .filter((row: { id: number }) => row.id !== excludeId)
                    .map((row: { id: number; name: string; phone?: string | null }) => ({
                        id: row.id, name: row.name, phone: row.phone ?? null,
                    }));
                setHits(rows.slice(0, 10));
            } catch {
                if (!cancelled) setHits([]);
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 250);
        return () => { cancelled = true; clearTimeout(handle); };
    }, [query, kind, excludeId, selected]);

    return (
        <div className="relative">
            <Label className="text-xs uppercase text-muted-foreground">{label}</Label>
            <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={selected ? `${selected.name} (#${selected.id})` : query}
                    onChange={(e) => { setQuery(e.target.value); onSelect(null); }}
                    placeholder="Search by name or phone…"
                    className="pl-8 pr-8"
                />
                {selected ? (
                    <button
                        type="button"
                        onClick={() => { onSelect(null); setQuery(""); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label="Clear"
                    >×</button>
                ) : searching ? (
                    <Loader2 className="absolute right-2 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                ) : null}
            </div>
            {hits.length > 0 && !selected ? (
                <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow">
                    {hits.map((hit) => (
                        <button
                            key={hit.id}
                            type="button"
                            onClick={() => { onSelect(hit); setQuery(""); setHits([]); }}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                            <div className="font-medium">{hit.name}</div>
                            {hit.phone ? <div className="text-xs text-muted-foreground">{hit.phone}</div> : null}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

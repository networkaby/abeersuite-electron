"use client";

/**
 * Usable Fund — "how much money can this business actually deploy today?"
 *
 * LIVE — reads real ledgers from GET /api/accountancy/reports/usable-fund
 * (Cash-in-Hand, Bank Accounts, Bank OD A/c, Credit Card, BNPL A/c, Wallets,
 * Payment Gateway). The API returns per-ledger building blocks only (amount,
 * limit, tier, convertibility, feePct, sharedLimitKey); every bit of
 * netting/summing below happens here, client-side, so the math lives in
 * exactly one place.
 *
 * The concept:
 *
 *   Every LEDGER carries a single `tier` field — INSTANT or OTHER. That one
 *   field decides which section a ledger appears in. Tier is per-ledger, not
 *   per-bucket: two ledgers under the same bucket (e.g. two Payment Gateway
 *   accounts, one settling same-day and one taking weeks) can sit in
 *   different sections. A bucket shows up in both sections when it has
 *   ledgers of both tiers.
 *
 *   INSTANT — the ledger balance / facility headroom IS the money.
 *   OTHER   — capacity that needs its own resolution before it is spendable.
 *
 *   Total Fund = Instant Fund + Other Fund.
 *
 *   Each OTHER-tier ledger carries internal `convertibility` / `feePct`
 *   fields that decide how much of its capacity actually counts toward
 *   Other Fund — deliberately NOT surfaced in the UI, only in the number.
 *
 *   Ledgers that share one sanctioned limit (e.g. a primary + add-on credit
 *   card) carry the same `sharedLimitKey`. Headroom is computed against the
 *   family's COMBINED drawn amount, so every sibling's row correctly shows
 *   the same combined figure — and sumFund() counts that one shared limit
 *   exactly once toward the totals, not once per ledger. Mirrors
 *   combinedDrawnByCreditCardKey() / netFundTotal() in the real facilityLimit.ts.
 *
 * Open questions parked for the concept review (see chat):
 *   1. RESOLVED — all seven groups are live: Cash-in-Hand / Bank Accounts /
 *      Bank OD A/c / Credit Card were already live; BNPL A/c and Wallets were
 *      added via prisma/seeds/apply-account-groups.ts; Payment Gateway was
 *      already a real-config group (personal.local.json) before this feature
 *      existed. The bnplJson/walletJson/gatewayJson columns are pushed.
 *   2. RESOLVED — masters/ledgers page + EditLedgerDialog both have a
 *      "Usable Fund Tier" control for every group with a tier concept.
 *      `convertibility` / `feePct` still have no control (safe defaults only).
 *   3. Whether buckets also split by branch.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import {
    Wallet,
    Landmark,
    Smartphone,
    Banknote,
    CreditCard,
    ShoppingBag,
    Waypoints,
    HandCoins,
    ChevronDown,
    ChevronRight,
    Loader2,
    RefreshCw,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";

// ─── Shape (mirrors the API response) ────────────────────────────────────────

/** Which section a ledger appears under. The single knob to move a ledger. */
type FundTier = "INSTANT" | "OTHER";

/**
 * Internal only — decides how much of an OTHER-tier ledger's capacity counts
 * toward Other Fund. Never shown in the UI.
 */
type Convertibility = "CONVERTIBLE" | "RESTRICTED" | "UNAVAILABLE";

type FundLedger = {
    name: string;
    note?: string | null;
    /** Balance (own-money ledgers) or amount drawn (credit facilities). */
    amount: number;
    /** Sanctioned limit — only ledgers that are a credit facility. */
    limit?: number | null;
    tier: FundTier;
    /** OTHER-tier ledgers only — internal, not displayed. */
    convertibility?: Convertibility | null;
    /** Internal only — applied when convertibility is CONVERTIBLE. */
    feePct?: number | null;
    /**
     * Set ONLY when this ledger shares its sanctioned limit with one or more
     * sibling ledgers (e.g. a primary + add-on card issued under one combined
     * limit) — same key on every ledger in the family. Headroom is then
     * computed against the FAMILY's combined drawn amount, and the family's
     * one shared limit counts toward Instant/Other Fund exactly once, not
     * once per ledger.
     */
    sharedLimitKey?: string | null;
};

type ApiBucket = {
    key: string;
    label: string;
    groupName: string;
    ledgers: FundLedger[];
};

type FundGroup = ApiBucket & {
    icon: LucideIcon;
    tone: string;
    /** Utilisation-bar fill colour — only rendered on credit-type ledgers (those with a limit). */
    barTone: string;
};

// Presentation only — the API has no opinion on icons/colours. Buckets not
// listed here (shouldn't happen for the four live groups) fall back to a
// generic look rather than being dropped.
const STYLE_BY_KEY: Record<string, { icon: LucideIcon; tone: string; barTone: string }> = {
    cash: { icon: Wallet, tone: "text-emerald-600 dark:text-emerald-400", barTone: "bg-emerald-500" },
    bank: { icon: Landmark, tone: "text-blue-600 dark:text-blue-400", barTone: "bg-blue-500" },
    od: { icon: Banknote, tone: "text-teal-600 dark:text-teal-400", barTone: "bg-teal-500" },
    card: { icon: CreditCard, tone: "text-rose-600 dark:text-rose-400", barTone: "bg-rose-500" },
    // Ready for when these groups exist — harmless until then, they just never render.
    bnpl: { icon: ShoppingBag, tone: "text-cyan-600 dark:text-cyan-400", barTone: "bg-cyan-500" },
    wallets: { icon: Smartphone, tone: "text-violet-600 dark:text-violet-400", barTone: "bg-violet-500" },
    gateway: { icon: Waypoints, tone: "text-indigo-600 dark:text-indigo-400", barTone: "bg-indigo-500" },
};
const FALLBACK_STYLE = { icon: HandCoins, tone: "text-foreground", barTone: "bg-foreground" };

// ─── Derivation ──────────────────────────────────────────────────────────────

/** sharedLimitKey → combined amount drawn across every ledger in that family. */
function sharedDrawnByKey(groups: FundGroup[]): Record<string, number> {
    const map: Record<string, number> = {};
    for (const g of groups) {
        for (const l of g.ledgers) {
            if (!l.sharedLimitKey) continue;
            map[l.sharedLimitKey] = (map[l.sharedLimitKey] ?? 0) + l.amount;
        }
    }
    return map;
}

/**
 * Raw capacity: headroom for a credit facility (has a limit), balance
 * otherwise. A ledger with sharedLimitKey uses the FAMILY's combined drawn
 * amount, not just its own — two cards sharing one limit both show the same
 * (correct) headroom, matching the bank's own app.
 */
const capacityOf = (l: FundLedger, drawnByKey: Record<string, number>): number => {
    if (l.limit == null) return l.amount;
    const drawn = l.sharedLimitKey ? (drawnByKey[l.sharedLimitKey] ?? l.amount) : l.amount;
    return Math.max(0, l.limit - drawn);
};

/** What this ONE ledger's row shows as counting toward Usable Fund. Do not
 *  sum this across many ledgers directly — see sumFund() below. */
const netValueOf = (l: FundLedger, drawnByKey: Record<string, number>): number => {
    const capacity = capacityOf(l, drawnByKey);
    if (l.tier === "INSTANT") return capacity;
    if (l.convertibility === "CONVERTIBLE") return capacity * (1 - (l.feePct ?? 0) / 100);
    return 0; // RESTRICTED / UNAVAILABLE — not counted
};

/**
 * Correct total across many ledgers — the function to use instead of
 * `ledgers.reduce((s, l) => s + netValueOf(l), 0)`. Ledgers sharing a
 * sharedLimitKey contribute their one shared limit's headroom exactly once
 * (the first ledger encountered), not once per ledger in the family.
 */
const sumFund = (ledgers: FundLedger[], drawnByKey: Record<string, number>): number => {
    const countedKeys = new Set<string>();
    let total = 0;
    for (const l of ledgers) {
        if (l.sharedLimitKey) {
            if (countedKeys.has(l.sharedLimitKey)) continue;
            countedKeys.add(l.sharedLimitKey);
        }
        total += netValueOf(l, drawnByKey);
    }
    return total;
};

/** Ledgers of one bucket that belong to a given section. */
const ledgersInTier = (g: FundGroup, tier: FundTier): FundLedger[] =>
    g.ledgers.filter((l) => l.tier === tier);

export default function UsableFundPage() {
    const [asOf, setAsOf] = useState(toIsoDate(new Date()));
    const [groups, setGroups] = useState<FundGroup[] | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        axios
            .get<{ asOf: string; buckets: ApiBucket[] }>(
                `/api/accountancy/reports/usable-fund?asOf=${asOf}`,
            )
            .then((r) => {
                setGroups(
                    r.data.buckets.map((b) => ({
                        ...b,
                        ...(STYLE_BY_KEY[b.key] ?? FALLBACK_STYLE),
                    })),
                );
            })
            .catch(() => toast.error("Failed to load Usable Fund"))
            .finally(() => setLoading(false));
    }, [asOf]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(load, [load]);

    // This page has no shared cache with the Ledgers page — a ledger saved
    // there doesn't push an update here. Refetch when the tab regains focus
    // (switched away and back, e.g. after creating a ledger elsewhere) so a
    // full reload isn't the only way to see fresh data.
    useEffect(() => {
        const onVisible = () => { if (document.visibilityState === "visible") load(); };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);
        return () => {
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("focus", onVisible);
        };
    }, [load]);

    const drawnByKey = useMemo(() => sharedDrawnByKey(groups ?? []), [groups]);

    const instantSections = useMemo(
        () => (groups ?? [])
            .map((g) => ({ group: g, ledgers: ledgersInTier(g, "INSTANT") }))
            .filter((s) => s.ledgers.length > 0),
        [groups],
    );
    const otherSections = useMemo(
        () => (groups ?? [])
            .map((g) => ({ group: g, ledgers: ledgersInTier(g, "OTHER") }))
            .filter((s) => s.ledgers.length > 0),
        [groups],
    );

    const instantTotal = sumFund(instantSections.flatMap((s) => s.ledgers), drawnByKey);
    const otherTotal = sumFund(otherSections.flatMap((s) => s.ledgers), drawnByKey);
    const totalFund = instantTotal + otherTotal;

    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-6xl space-y-5 px-6 pt-3 pb-8">
                {/* ── Header ──────────────────────────────────────────────── */}
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
                            <HandCoins size={22} className="text-primary" />
                            Usable Fund
                        </h1>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                            What the business can actually deploy today, across every source of funds.
                        </p>
                    </div>
                    <div className="flex items-end gap-2">
                        <div className="space-y-1">
                            <Label>As on</Label>
                            <TallyDateInput value={asOf} onValueChange={setAsOf} className="w-auto" />
                        </div>
                        <button
                            type="button"
                            onClick={load}
                            title="Refresh — a ledger saved elsewhere doesn't push an update here"
                            className={`mb-[3px] text-muted-foreground hover:text-foreground transition-colors ${loading ? "animate-spin" : ""}`}
                        >
                            <RefreshCw size={15} />
                        </button>
                    </div>
                </div>

                {loading && !groups && (
                    <div className="flex justify-center py-16">
                        <Loader2 className="animate-spin text-muted-foreground" size={26} />
                    </div>
                )}

                {groups && (
                    <>
                        {/* ── Hero tiles ──────────────────────────────────────── */}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <HeroTile
                                label="Instant Fund"
                                value={instantTotal}
                                tone="text-emerald-600 dark:text-emerald-400"
                            />
                            <HeroTile
                                label="Other Fund"
                                value={otherTotal}
                                tone="text-amber-600 dark:text-amber-400"
                            />
                            <HeroTile
                                label="Total Fund"
                                value={totalFund}
                                tone="text-primary"
                                primary
                            />
                        </div>

                        {/* ── Instant ─────────────────────────────────────────── */}
                        <SectionHeading title="Instant" total={instantTotal} />
                        {instantSections.length === 0 ? (
                            <EmptySection />
                        ) : (
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                {instantSections.map((s) => (
                                    <GroupCard key={s.group.key} group={s.group} ledgers={s.ledgers} drawnByKey={drawnByKey} />
                                ))}
                            </div>
                        )}

                        {/* ── Other ───────────────────────────────────────────── */}
                        <SectionHeading title="Other" total={otherTotal} />
                        {otherSections.length === 0 ? (
                            <EmptySection />
                        ) : (
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                {otherSections.map((s) => (
                                    <GroupCard key={s.group.key} group={s.group} ledgers={s.ledgers} drawnByKey={drawnByKey} />
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </ScrollArea>
    );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function HeroTile({
    label,
    value,
    tone,
    primary = false,
}: {
    label: string;
    value: number;
    tone: string;
    primary?: boolean;
}) {
    return (
        <div
            className={[
                "rounded-lg border bg-card px-4 py-3 shadow-sm",
                primary ? "border-primary/40 ring-1 ring-primary/20" : "border-border",
            ].join(" ")}
        >
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <div className={`mt-1 font-mono text-2xl font-bold tabular-nums ${tone}`}>
                ₹{fmt(value)}
            </div>
        </div>
    );
}

function SectionHeading({ title, total }: { title: string; total: number }) {
    return (
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border pt-2 pb-1.5">
            <h2 className="text-base font-semibold">{title}</h2>
            <div className="font-mono text-sm font-bold tabular-nums">₹{fmt(total)}</div>
        </div>
    );
}

function EmptySection() {
    return <p className="py-3 text-xs text-muted-foreground italic">No ledgers in this section.</p>;
}

function GroupCard({
    group,
    ledgers,
    drawnByKey,
}: {
    group: FundGroup;
    ledgers: FundLedger[];
    drawnByKey: Record<string, number>;
}) {
    const [open, setOpen] = useState(true);
    const Icon = group.icon;
    const net = sumFund(ledgers, drawnByKey);

    return (
        <div className="rounded-lg border border-border bg-card shadow-sm">
            {/* Header */}
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
            >
                {open ? (
                    <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                ) : (
                    <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                )}
                <Icon size={15} className={`shrink-0 ${group.tone}`} />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{group.label}</div>
                    <div className="truncate text-[11px] text-muted-foreground italic">
                        {group.groupName} · {ledgers.length} ledger
                        {ledgers.length === 1 ? "" : "s"}
                    </div>
                </div>
                <div className="shrink-0 text-right">
                    <div className={`font-mono text-sm font-bold tabular-nums ${group.tone}`}>
                        ₹{fmt(net)}
                    </div>
                </div>
            </button>

            {/* Body */}
            {open && (
                <div className="divide-y divide-border border-t border-border">
                    {ledgers.map((l) => (
                        <LedgerRow key={l.name} ledger={l} barTone={group.barTone} drawnByKey={drawnByKey} />
                    ))}
                </div>
            )}
        </div>
    );
}

function LedgerRow({
    ledger,
    barTone,
    drawnByKey,
}: {
    ledger: FundLedger;
    barTone: string;
    drawnByKey: Record<string, number>;
}) {
    const capacity = capacityOf(ledger, drawnByKey);
    const net = netValueOf(ledger, drawnByKey);
    const isCredit = ledger.limit != null;
    const pct = isCredit ? Math.min(100, Math.round((ledger.amount / (ledger.limit ?? 1)) * 100)) : 0;
    const tight = isCredit && pct >= 90;

    return (
        <div className="px-4 py-2.5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-sm">{ledger.name}</div>
                    {ledger.note && (
                        <div className="text-[11px] text-muted-foreground italic">{ledger.note}</div>
                    )}
                </div>
                <div className="shrink-0 font-mono text-sm font-medium tabular-nums">
                    ₹{fmt(net)}
                </div>
            </div>

            {/* Limit / Used / Available breakdown — credit facilities only */}
            {isCredit && (
                <>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
                        <Metric label="Limit" value={ledger.limit ?? 0} />
                        <Metric label="Used" value={ledger.amount} />
                        <Metric label="Headroom" value={capacity} strong />
                    </div>
                    <div className="mt-1.5">
                        <Bar pct={pct} tone={tight ? "bg-red-500" : barTone} />
                    </div>
                </>
            )}
        </div>
    );
}

function Bar({ pct, tone }: { pct: number; tone: string }) {
    return (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
    );
}

function Metric({
    label,
    value,
    strong = false,
}: {
    label: string;
    value: number;
    strong?: boolean;
}) {
    return (
        <div>
            <div className="text-muted-foreground">{label}</div>
            <div className={`font-mono tabular-nums ${strong ? "font-semibold text-foreground" : ""}`}>
                ₹{fmt(value)}
            </div>
        </div>
    );
}

"use client";

/**
 * Usable Fund — "how much money can this business actually deploy today?"
 *
 * ⚠ DESIGN PREVIEW — UI ONLY. Every number on this page comes from the MOCK
 * constant below. Nothing is fetched, nothing is posted, no schema exists yet.
 * The shape of MOCK is deliberately the shape a future
 * `GET /api/accountancy/reports/usable-fund` should return, so wiring later is
 * a swap of the constant for an axios call — no re-layout.
 *
 * The concept: usable fund = OWN money + BORROWED headroom.
 *   • own money      → the ledger balance IS the spendable amount (Cash, Bank, Wallets)
 *   • borrowed money → the spendable amount is the HEADROOM (limit − drawn):
 *                      Bank OD, Credit Cards, BNPL / Pay-Later facilities.
 *
 * Open questions parked for the concept review (see chat):
 *   1. New AccountGroups needed — "Credit Card A/c", "BNPL A/c", "Wallets".
 *      "Cash-in-Hand" / "Bank Accounts" / "Bank OD A/c" already exist.
 *   2. Where the sanctioned limit is stored — reuse Account.creditLimit, or a
 *      separate field so customer limits and our own facility limits don't mix.
 *   3. Whether buckets also split by branch.
 */

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
    Wallet,
    Landmark,
    Smartphone,
    Banknote,
    CreditCard,
    ShoppingBag,
    HandCoins,
    ChevronDown,
    ChevronRight,
    AlertTriangle,
    Info,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";

// ─── Shape (mirrors the future API response) ─────────────────────────────────

type FundLedger = {
    name: string;
    /**
     * For an "own" bucket: the ledger closing balance.
     * For a "credit" bucket: the amount already DRAWN / outstanding.
     */
    amount: number;
    /** Sanctioned limit — credit buckets only. */
    limit?: number;
    /** Free-text hint shown under the ledger name (due date, card last-4, …). */
    note?: string;
};

type FundBucket = {
    key: string;
    label: string;
    /** The AccountGroup this bucket will read from once wired. */
    groupName: string;
    icon: LucideIcon;
    /**
     * own    — the balance itself is spendable.
     * credit — spendable = limit − drawn (headroom).
     */
    kind: "own" | "credit";
    /** Tailwind text colour for the bucket's accent. */
    tone: string;
    /** Tailwind bg for the utilisation bar fill. */
    barTone: string;
    ledgers: FundLedger[];
};

// ─── Mock data (replace with the API payload when wiring) ────────────────────

const MOCK: FundBucket[] = [
    {
        key: "cash",
        label: "Cash in Hand",
        groupName: "Cash-in-Hand",
        icon: Wallet,
        kind: "own",
        tone: "text-emerald-600 dark:text-emerald-400",
        barTone: "bg-emerald-500",
        ledgers: [
            { name: "Cash", amount: 42500 },
            { name: "Petty Cash", amount: 3200 },
            { name: "Counter 1 Till", amount: 11750, note: "shift open" },
        ],
    },
    {
        key: "bank",
        label: "Bank Accounts",
        groupName: "Bank Accounts",
        icon: Landmark,
        kind: "own",
        tone: "text-blue-600 dark:text-blue-400",
        barTone: "bg-blue-500",
        ledgers: [
            { name: "HDFC Current", amount: 286400, note: "A/c ••••4471" },
            { name: "SBI Current", amount: 74150, note: "A/c ••••9082" },
            { name: "ICICI Savings", amount: 18900, note: "A/c ••••3310" },
        ],
    },
    {
        key: "wallets",
        label: "Wallets",
        groupName: "Wallets  (group not created yet)",
        icon: Smartphone,
        kind: "own",
        tone: "text-violet-600 dark:text-violet-400",
        barTone: "bg-violet-500",
        ledgers: [
            { name: "Paytm Business", amount: 12400 },
            { name: "PhonePe Merchant", amount: 6850 },
            { name: "Razorpay Payout Balance", amount: 31200, note: "settles T+1" },
        ],
    },
    {
        key: "od",
        label: "Bank Overdraft",
        groupName: "Bank OD A/c",
        icon: Banknote,
        kind: "credit",
        tone: "text-amber-600 dark:text-amber-400",
        barTone: "bg-amber-500",
        ledgers: [
            { name: "HDFC OD", amount: 345000, limit: 1000000, note: "A/c ••••5520 · renews 31-Mar" },
        ],
    },
    {
        key: "card",
        label: "Credit Cards",
        groupName: "Credit Card A/c  (group not created yet)",
        icon: CreditCard,
        kind: "credit",
        tone: "text-rose-600 dark:text-rose-400",
        barTone: "bg-rose-500",
        ledgers: [
            { name: "HDFC Business Regalia", amount: 112600, limit: 300000, note: "••••8842 · due 05-Aug" },
            { name: "SBI SimplySAVE", amount: 96300, limit: 100000, note: "••••2217 · due 12-Aug" },
        ],
    },
    {
        key: "bnpl",
        label: "BNPL / Pay Later",
        groupName: "BNPL A/c  (group not created yet)",
        icon: ShoppingBag,
        kind: "credit",
        tone: "text-cyan-600 dark:text-cyan-400",
        barTone: "bg-cyan-500",
        ledgers: [
            { name: "Amazon Pay Later", amount: 18000, limit: 60000 },
            { name: "Flipkart Pay Later", amount: 0, limit: 40000 },
        ],
    },
];

// ─── Derivation ──────────────────────────────────────────────────────────────

/** Spendable money from one ledger: balance for own, headroom for credit. */
const usableOf = (b: FundBucket, l: FundLedger): number =>
    b.kind === "own" ? l.amount : Math.max(0, (l.limit ?? 0) - l.amount);

const bucketUsable = (b: FundBucket): number =>
    b.ledgers.reduce((s, l) => s + usableOf(b, l), 0);

const sum = (bs: FundBucket[]): number => bs.reduce((s, b) => s + bucketUsable(b), 0);

/** 0–100; how much of a credit line is already eaten. */
const utilPct = (limit: number, drawn: number): number =>
    limit <= 0 ? 0 : Math.min(100, Math.round((drawn / limit) * 100));

export default function UsableFundPage() {
    const [asOf, setAsOf] = useState(toIsoDate(new Date()));

    const own = MOCK.filter((b) => b.kind === "own");
    const credit = MOCK.filter((b) => b.kind === "credit");

    const ownTotal = sum(own);
    const creditTotal = sum(credit);
    const grandTotal = ownTotal + creditTotal;

    const creditSanctioned = credit.reduce(
        (s, b) => s + b.ledgers.reduce((t, l) => t + (l.limit ?? 0), 0),
        0,
    );
    const creditDrawn = credit.reduce(
        (s, b) => s + b.ledgers.reduce((t, l) => t + l.amount, 0),
        0,
    );

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
                            What the business can actually spend today — own money in hand plus
                            unused credit headroom.
                        </p>
                    </div>
                    <div className="space-y-1">
                        <Label>As on</Label>
                        <TallyDateInput value={asOf} onValueChange={setAsOf} className="w-auto" />
                    </div>
                </div>

                {/* ── Preview banner ──────────────────────────────────────── */}
                <div className="flex items-start gap-2 rounded-lg border border-dashed border-amber-500/50 bg-amber-500/5 px-4 py-2.5">
                    <Info size={15} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                        <span className="font-semibold">Design preview.</span> Every figure below is
                        sample data — no ledger is read, no limit is stored yet. Confirm the layout
                        and the buckets, then we create the groups + limit field and wire it live.
                    </p>
                </div>

                {/* ── Hero tiles ──────────────────────────────────────────── */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <HeroTile
                        label="Own Money"
                        sub="Cash + Bank + Wallets"
                        value={ownTotal}
                        tone="text-emerald-600 dark:text-emerald-400"
                    />
                    <HeroTile
                        label="Credit Headroom"
                        sub="OD + Cards + BNPL, unused"
                        value={creditTotal}
                        tone="text-amber-600 dark:text-amber-400"
                    />
                    <HeroTile
                        label="Total Usable Fund"
                        sub="own money + headroom"
                        value={grandTotal}
                        tone="text-primary"
                        primary
                    />
                </div>

                {/* ── Own money ───────────────────────────────────────────── */}
                <SectionHeading
                    title="Own Money"
                    caption="Ours to spend — the ledger balance is the usable amount."
                    total={ownTotal}
                />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {own.map((b) => (
                        <BucketCard key={b.key} bucket={b} />
                    ))}
                </div>

                {/* ── Credit headroom ─────────────────────────────────────── */}
                <SectionHeading
                    title="Credit Headroom"
                    caption={`Borrowed capacity — usable = limit − drawn. ₹${fmt(creditDrawn)} drawn of ₹${fmt(creditSanctioned)} sanctioned.`}
                    total={creditTotal}
                />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {credit.map((b) => (
                        <BucketCard key={b.key} bucket={b} />
                    ))}
                </div>

                {/* ── How it is calculated ────────────────────────────────── */}
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                    <h3 className="mb-1.5 text-sm font-semibold">How this is calculated</h3>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                        <li>
                            <span className="font-medium text-foreground">Cash / Bank / Wallets</span>{" "}
                            — closing balance of every ledger under the group, as on the chosen date.
                        </li>
                        <li>
                            <span className="font-medium text-foreground">OD / Credit Card / BNPL</span>{" "}
                            — sanctioned limit minus the outstanding drawn amount. Never below zero,
                            so an over-limit account contributes nothing instead of eating other funds.
                        </li>
                        <li>
                            <span className="font-medium text-foreground">Total Usable Fund</span> — own
                            money + credit headroom. It is a spending-capacity number, not a balance
                            sheet figure: borrowed headroom is not an asset.
                        </li>
                    </ul>
                </div>
            </div>
        </ScrollArea>
    );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function HeroTile({
    label,
    sub,
    value,
    tone,
    primary = false,
}: {
    label: string;
    sub: string;
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
            <div className="mt-0.5 text-[11px] text-muted-foreground italic">{sub}</div>
        </div>
    );
}

function SectionHeading({
    title,
    caption,
    total,
}: {
    title: string;
    caption: string;
    total: number;
}) {
    return (
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border pt-2 pb-1.5">
            <div>
                <h2 className="text-base font-semibold">{title}</h2>
                <p className="text-xs text-muted-foreground">{caption}</p>
            </div>
            <div className="font-mono text-sm font-bold tabular-nums">₹{fmt(total)}</div>
        </div>
    );
}

function BucketCard({ bucket }: { bucket: FundBucket }) {
    const [open, setOpen] = useState(true);
    const Icon = bucket.icon;
    const usable = bucketUsable(bucket);

    const sanctioned = bucket.ledgers.reduce((s, l) => s + (l.limit ?? 0), 0);
    const drawn = bucket.ledgers.reduce((s, l) => s + l.amount, 0);
    const pct = bucket.kind === "credit" ? utilPct(sanctioned, drawn) : 0;

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
                <Icon size={15} className={`shrink-0 ${bucket.tone}`} />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{bucket.label}</div>
                    <div className="truncate text-[11px] text-muted-foreground italic">
                        {bucket.groupName} · {bucket.ledgers.length} ledger
                        {bucket.ledgers.length === 1 ? "" : "s"}
                    </div>
                </div>
                <div className="shrink-0 text-right">
                    <div className={`font-mono text-sm font-bold tabular-nums ${bucket.tone}`}>
                        ₹{fmt(usable)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                        {bucket.kind === "own" ? "balance" : "available"}
                    </div>
                </div>
            </button>

            {/* Body */}
            {open && (
                <div className="divide-y divide-border border-t border-border">
                    {bucket.ledgers.map((l) => (
                        <LedgerRow key={l.name} bucket={bucket} ledger={l} />
                    ))}

                    {/* Bucket-level utilisation, credit buckets only */}
                    {bucket.kind === "credit" && (
                        <div className="px-4 py-2.5">
                            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                                <span>Utilised {pct}%</span>
                                <span className="font-mono tabular-nums">
                                    ₹{fmt(drawn)} / ₹{fmt(sanctioned)}
                                </span>
                            </div>
                            <Bar pct={pct} tone={bucket.barTone} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function LedgerRow({ bucket, ledger }: { bucket: FundBucket; ledger: FundLedger }) {
    const usable = usableOf(bucket, ledger);
    const isCredit = bucket.kind === "credit";
    const limit = ledger.limit ?? 0;
    const pct = isCredit ? utilPct(limit, ledger.amount) : 0;
    const tight = isCredit && pct >= 90;

    return (
        <div className="px-4 py-2.5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm">
                        <span className="truncate">{ledger.name}</span>
                        {tight && (
                            <AlertTriangle
                                size={12}
                                className="shrink-0 text-red-500"
                            />
                        )}
                    </div>
                    {ledger.note && (
                        <div className="text-[11px] text-muted-foreground italic">{ledger.note}</div>
                    )}
                </div>
                <div
                    className={`shrink-0 font-mono text-sm font-medium tabular-nums ${tight ? "text-red-600 dark:text-red-400" : ""}`}
                >
                    ₹{fmt(usable)}
                </div>
            </div>

            {/* Limit / Used / Available breakdown */}
            {isCredit && (
                <>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
                        <Metric label="Limit" value={limit} />
                        <Metric label="Used" value={ledger.amount} />
                        <Metric label="Available" value={usable} strong />
                    </div>
                    <div className="mt-1.5">
                        <Bar pct={pct} tone={tight ? "bg-red-500" : bucket.barTone} />
                    </div>
                </>
            )}
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

function Bar({ pct, tone }: { pct: number; tone: string }) {
    return (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
    );
}

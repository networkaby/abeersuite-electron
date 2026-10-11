"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import axios from "axios";
import { fmt } from "@/shared/lib/format/moneyInr";
import { getActiveModule } from "@/utils/active-module";
import { moduleColor } from "@/shared/lib/format/moduleTheme";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { canOpenPage } from "@/shared/lib/auth/pageAccess";
import { Wallet, Building2, TrendingUp, TrendingDown, RefreshCw, SquareChevronDown, SquareChevronUp, Wrench, HandCoins } from "lucide-react";
import { toast } from "sonner";
import { usePanelStore } from "@/store/panelStore";
import { BranchSwitcher } from "@/shared/components/BranchSwitcher";
import SyncStatusBadge from "@/shared/components/SyncStatusBadge";
import { usePolling } from "@/shared/hooks/usePolling";
import { FINANCE_BAR_POLL_MS } from "@/shared/lib/constants/polling";
import { readCache, subscribeToCache, writeCache } from "@/shared/lib/browser/pollCache";


type CashPosition = {
    asOf: string;
    cash: number;
    bank: number;
    receivables: number;
    payables: number;
    cashAccounts: { name: string; balance: number }[];
    bankAccounts: { name: string; balance: number }[];
};

type Computed<T> = (T & { computedAt: string }) | { unchanged: true; computedAt: string };

// Cross-tab: each fetch is mirrored into localStorage, so a second open tab
// paints instantly and every tab adopts fresh figures the moment ANY tab
// fetches them — an office user with several tabs open is not running several
// independent polls. Unscoped keys on purpose: a cash or bank balance is the
// same figure for whoever is signed in, unlike the per-user sidebar badges.
const CASH_CACHE_KEY = "finance-cash-cache:v1";
const FUND_CACHE_KEY = "finance-fund-cache:v1";

type FundPayload = { instantTotal: number };

function Pill({
    icon,
    label,
    value,
    href,
    detail,
    colorClass,
    normalSide = "DEBIT",
}: {
    icon: React.ReactNode;
    label: string;
    value: number;
    /** The report behind the figure — left out when this person cannot open it
     *  (pageAccess.ts), so the figure shows but leads nowhere. */
    href?: string;
    detail?: { name: string; balance: number }[];
    colorClass?: string;
    normalSide?: "DEBIT" | "CREDIT";
}) {
    const [open, setOpen] = useState(false);
    const router = useRouter();
    const negative = value < 0;
    const hasDropdown = !!detail && detail.length > 1;
    const sideSuffix = normalSide === "CREDIT" ? "(Dr)" : "(Cr)";

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => (hasDropdown ? setOpen((o) => !o) : href && router.push(href))}
                className={[
                    "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                    hasDropdown || href ? "hover:bg-muted/60" : "cursor-default",
                    negative ? "text-red-600 dark:text-red-400" : (colorClass ?? "text-foreground"),
                ].join(" ")}
            >
                <span className="shrink-0 opacity-90">{icon}</span>
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono font-semibold">₹{fmt(Math.abs(value))}</span>
                {negative && <span className="text-[10px] text-red-500">{sideSuffix}</span>}
            </button>

            {/* Sub-account dropdown */}
            {open && hasDropdown && (
                <div className="absolute left-0 top-full z-50 mt-1 min-w-50 rounded-lg border border-border bg-popover py-1 shadow-lg">
                    {detail.map((d) => (
                        <div
                            key={d.name}
                            className="flex items-center justify-between gap-4 px-3 py-1.5 text-xs hover:bg-muted/60"
                        >
                            <span className="text-muted-foreground truncate">{d.name}</span>
                            <span className={`font-mono font-medium shrink-0 ${d.balance < 0 ? "text-red-500" : ""}`}>
                                ₹{fmt(Math.abs(d.balance))}
                            </span>
                        </div>
                    ))}
                    {href && (
                        <div className="border-t border-border mt-1 pt-1 px-3 pb-1">
                            <Link
                                href={href}
                                className="text-[11px] text-primary hover:underline"
                                onClick={() => setOpen(false)}
                            >
                                View full ledger →
                            </Link>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default function FinanceTopBar({
    permissions = [],
}: {
    permissions?: string[];
}) {
    const canView = hasModuleNavAccess(permissions, "accountancy");
    // A figure links to its report only when this person may open that page.
    const openable = (href: string) => (canOpenPage(href, permissions) ? href : undefined);
    // Seeded from localStorage only in the mount effect below — reading it here in
    // a lazy initialiser would render different HTML on server (no window) vs
    // client (cache hit), a hydration mismatch.
    const [data, setData] = useState<CashPosition | null>(null);
    const [instantFund, setInstantFund] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [recomputing, setRecomputing] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const recompute = useCallback(async () => {
        setRecomputing(true);
        try {
            const { data: r } = await axios.post<{ driftCount: number }>(
                "/api/accountancy/maintenance/recompute-balances",
            );
            toast.success(
                r.driftCount === 0
                    ? "Cached balances in sync."
                    : `Repaired ${r.driftCount} drifted account${r.driftCount === 1 ? "" : "s"}.`,
            );
        } catch {
            toast.error("Recompute failed");
        } finally {
            setRecomputing(false);
        }
    }, []);

    // Each request hands the server back the computedAt it got last time, so an
    // unchanged poll costs one cheap existence check instead of a full recompute
    // — the "last known good" figures live here in the browser, not on the
    // (stateless) server, so nothing needs to be cached server-side.
    // `useRef`'s argument is evaluated on every render, so these are seeded in
    // the effect below instead — reading localStorage each render would be waste.
    const cashSince = useRef<string | null>(null);
    const fundSince = useRef<string | null>(null);

    // Declared before the poll below so it seeds the timestamps first: effects
    // run in declaration order, and the poll's first fetch should already be
    // able to say "since". Also adopts whatever another tab fetches, live.
    useEffect(() => {
        // Paint the cached figures immediately (post-hydration, so this is safe),
        // then let the poll below refresh them.
        const cachedCash = readCache<CashPosition>(CASH_CACHE_KEY);
        const cachedFund = readCache<FundPayload>(FUND_CACHE_KEY);
        if (cachedCash) setData(cachedCash.data);
        if (cachedFund) setInstantFund(cachedFund.data.instantTotal);
        cashSince.current = cachedCash?.computedAt ?? null;
        fundSince.current = cachedFund?.computedAt ?? null;

        const stopCash = subscribeToCache<CashPosition>(CASH_CACHE_KEY, (entry) => {
            cashSince.current = entry.computedAt;
            setData(entry.data);
            setLastUpdated(new Date());
        });
        const stopFund = subscribeToCache<FundPayload>(FUND_CACHE_KEY, (entry) => {
            fundSince.current = entry.computedAt;
            setInstantFund(entry.data.instantTotal);
        });
        return () => { stopCash(); stopFund(); };
    }, []);

    const load = useCallback(() => {
        if (!canView) return;
        setLoading(true);
        axios
            .get<Computed<CashPosition>>("/api/accountancy/reports/cash-position", {
                params: cashSince.current ? { since: cashSince.current } : undefined,
            })
            .then(({ data: res }) => {
                if (!res?.computedAt) return;
                cashSince.current = res.computedAt;
                if (!("unchanged" in res)) {
                    setData(res);
                    writeCache(CASH_CACHE_KEY, res, res.computedAt);
                }
                setLastUpdated(new Date());
            })
            .catch(() => {/* silent — non-critical UI */ })
            .finally(() => setLoading(false));
        axios
            .get<Computed<FundPayload>>("/api/accountancy/reports/usable-fund", {
                params: fundSince.current ? { since: fundSince.current } : undefined,
            })
            .then(({ data: res }) => {
                if (!res?.computedAt) return;
                fundSince.current = res.computedAt;
                if (!("unchanged" in res)) {
                    setInstantFund(res.instantTotal);
                    writeCache(FUND_CACHE_KEY, res, res.computedAt);
                }
            })
            .catch(() => {/* silent — non-critical UI */ });
    }, [canView]);

    // Ticks only while the tab is visible, and re-reads the position the moment it
    // is looked at again. Slow on purpose — the refresh button below is the way to
    // get the figure right now.
    usePolling(load, FINANCE_BAR_POLL_MS, canView);

    const { sidebarMode, barMode, toggleSidebarVisible, toggleBarVisible } = usePanelStore();

    // Which module the frame is currently sitting over. Null on the office shell
    // (home, welcome, the Workspace inboxes, a profile) — those are not modules,
    // so the chip renders nothing rather than inventing a name for them.
    const activeModule = getActiveModule(usePathname());

    return (
        <div className="dark chrome-surface flex h-9 shrink-0 items-center gap-0.5 border-b border-border-strong bg-surface-frame px-3 text-foreground">

            {/* Sidebar show/hide toggle */}
            <button
                type="button"
                title={sidebarMode === "hidden" ? "Show sidebar" : "Hide sidebar"}
                onClick={toggleSidebarVisible}
                className={["mr-2 rounded p-1 transition-colors", sidebarMode === "hidden" ? "opacity-40 hover:opacity-100 text-muted-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"].join(" ")}
            >
                {sidebarMode === "hidden"
                    ? <SquareChevronDown size={15} />
                    : <SquareChevronUp size={15} />}
            </button>

            {/* Where you are. This earns its place because of the toggle just to its
                left: with the sidebar hidden there is otherwise nothing on screen
                naming the module, and 49 office pages have no breadcrumb either.
                Icon carries the hue, label stays neutral — the same division the
                sidebar rail already uses, so twelve modules never shout at once.
                The money pills keep their own colours: those mean cash/bank/
                receivable, and a module hue must never compete with data. */}
            {activeModule && (
                <>
                    <span className="mr-1 flex shrink-0 items-center gap-1.5 text-xs font-medium" title={activeModule.label}>
                        <activeModule.icon size={13} style={{ color: moduleColor(activeModule.key) }} />
                        <span className="hidden truncate md:inline">{activeModule.label}</span>
                    </span>
                    <span className="mr-1 text-border">|</span>
                </>
            )}

            {/* Metrics — only when permitted */}
            {canView && data ? (
                <>
                    {instantFund != null && (
                        <>
                            <Pill
                                icon={<HandCoins size={12} />}
                                label="Instant Fund"
                                value={instantFund}
                                href={openable("/office/accountancy/usable-fund")}
                                colorClass="text-fuchsia-700 dark:text-fuchsia-400"
                            />
                            <span className="text-border">|</span>
                        </>
                    )}

                    <Pill
                        icon={<Wallet size={12} />}
                        label="Cash"
                        value={data.cash}
                        href={openable("/office/accountancy/reports/cash-book")}
                        detail={data.cashAccounts}
                        colorClass="text-emerald-700 dark:text-emerald-400"
                    />

                    <span className="text-border">|</span>

                    <Pill
                        icon={<Building2 size={12} />}
                        label="Bank"
                        value={data.bank}
                        href={openable("/office/accountancy/reports/bank-book")}
                        detail={data.bankAccounts}
                        colorClass="text-blue-700 dark:text-blue-400"
                    />

                    <span className="text-border">|</span>

                    <Pill
                        icon={<TrendingUp size={12} />}
                        label="Receivables"
                        value={data.receivables}
                        href={openable("/office/accountancy/reports/receivables")}
                        colorClass="text-sky-700 dark:text-sky-400"
                    />

                    <span className="text-border">|</span>

                    <Pill
                        icon={<TrendingDown size={12} />}
                        label="Payables"
                        value={data.payables}
                        href={openable("/office/accountancy/reports/payables")}
                        colorClass="text-amber-700 dark:text-amber-400"
                        normalSide="CREDIT"
                    />
                </>
            ) : canView ? (
                <span className="text-xs text-muted-foreground animate-pulse">Loading…</span>
            ) : null}

            {/* Right: connection state + branch switcher + refresh + timestamp + bar toggle */}
            <div className="ml-auto flex items-center gap-2">
                {/* Renders nothing unless this machine is a counter with something
                    worth reporting — see SyncStatusBadge. R/W state lives in the
                    window title bar (see StatusTitleUpdater) so it isn't duplicated here. */}
                <SyncStatusBadge />
                <BranchSwitcher />
                {canView && lastUpdated && (
                    <span className="text-[10px] text-muted-foreground/85 hidden sm:block">
                        {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                )}
                {canView && (
                    <button
                        type="button"
                        onClick={load}
                        title="Refresh financials"
                        className={`text-muted-foreground hover:text-foreground transition-colors ${loading ? "animate-spin" : ""}`}
                    >
                        <RefreshCw size={11} />
                    </button>
                )}
                {canView && (
                    <button
                        type="button"
                        onClick={recompute}
                        disabled={recomputing}
                        title="Recompute cached balances from journal entries (rarely needed — only if you suspect drift)"
                        className={`text-muted-foreground/85 hover:text-foreground transition-colors ${recomputing ? "animate-spin" : ""}`}
                    >
                        <Wrench size={11} />
                    </button>
                )}

                {/* Button bar show/hide toggle */}
                <button
                    type="button"
                    title={barMode === "hidden" ? "Show action bar" : "Hide action bar"}
                    onClick={toggleBarVisible}
                    className={["ml-1 rounded p-1 transition-colors", barMode === "hidden" ? "opacity-40 hover:opacity-100 text-muted-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"].join(" ")}
                >
                    {barMode === "hidden"
                        ? <SquareChevronDown size={15} />
                        : <SquareChevronUp size={15} />}
                </button>
            </div>
        </div>
    );
}

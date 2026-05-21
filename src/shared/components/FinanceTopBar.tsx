"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import axios from "axios";
import { fmt } from "@/utils/constants";
import { Wallet, Building2, TrendingUp, TrendingDown, RefreshCw, SquareChevronDown, SquareChevronUp, Wrench } from "lucide-react";
import { toast } from "sonner";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { usePanelStore } from "@/store/panelStore";
import { BranchSwitcher } from "@/shared/components/BranchSwitcher";


type CashPosition = {
    asOf: string;
    cash: number;
    bank: number;
    receivables: number;
    payables: number;
    cashAccounts: { name: string; balance: number }[];
    bankAccounts: { name: string; balance: number }[];
};

function Pill({
    icon,
    label,
    value,
    href,
    detail,
    colorClass,
}: {
    icon: React.ReactNode;
    label: string;
    value: number;
    href: string;
    detail?: { name: string; balance: number }[];
    colorClass?: string;
}) {
    const [open, setOpen] = useState(false);
    const negative = value < 0;

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className={[
                    "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                    "hover:bg-muted/60",
                    negative ? "text-red-600 dark:text-red-400" : (colorClass ?? "text-foreground"),
                ].join(" ")}
            >
                <span className="shrink-0 opacity-60">{icon}</span>
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono font-semibold">₹{fmt(Math.abs(value))}</span>
                {negative && <span className="text-[10px] text-red-500">(Dr)</span>}
            </button>

            {/* Sub-account dropdown */}
            {open && detail && detail.length > 1 && (
                <div className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-border bg-popover py-1 shadow-lg">
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
                    <div className="border-t border-border mt-1 pt-1 px-3 pb-1">
                        <Link
                            href={href}
                            className="text-[11px] text-primary hover:underline"
                            onClick={() => setOpen(false)}
                        >
                            View full ledger →
                        </Link>
                    </div>
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
    const canView = permissions.includes(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    const [data, setData] = useState<CashPosition | null>(null);
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

    const load = useCallback(() => {
        if (!canView) return;
        setLoading(true);
        axios
            .get<CashPosition>("/api/accountancy/reports/cash-position")
            .then((r) => {
                setData(r.data);
                setLastUpdated(new Date());
            })
            .catch(() => {/* silent — non-critical UI */ })
            .finally(() => setLoading(false));
    }, [canView]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load();
        const interval = setInterval(load, 60_000); // refresh every 60 s
        return () => clearInterval(interval);
    }, [load]);

    const { sidebarMode, barMode, toggleSidebarVisible, toggleBarVisible } = usePanelStore();

    return (
        <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-sidebar/60 px-3 backdrop-blur-sm">

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

            {/* Metrics — only when permitted */}
            {canView && data ? (
                <>
                    <Pill
                        icon={<Wallet size={12} />}
                        label="Cash"
                        value={data.cash}
                        href="/office/accountancy/reports/cash-book"
                        detail={data.cashAccounts}
                        colorClass="text-emerald-700 dark:text-emerald-400"
                    />

                    <span className="text-border">|</span>

                    <Pill
                        icon={<Building2 size={12} />}
                        label="Bank"
                        value={data.bank}
                        href="/office/accountancy/reports/bank-book"
                        detail={data.bankAccounts}
                        colorClass="text-blue-700 dark:text-blue-400"
                    />

                    <span className="text-border">|</span>

                    <Pill
                        icon={<TrendingUp size={12} />}
                        label="Receivables"
                        value={data.receivables}
                        href="/office/accountancy/reports/receivables"
                        colorClass="text-sky-700 dark:text-sky-400"
                    />

                    <span className="text-border">|</span>

                    <Pill
                        icon={<TrendingDown size={12} />}
                        label="Payables"
                        value={data.payables}
                        href="/office/accountancy/reports/payables"
                        colorClass="text-amber-700 dark:text-amber-400"
                    />
                </>
            ) : canView ? (
                <span className="text-xs text-muted-foreground animate-pulse">Loading…</span>
            ) : null}

            {/* Right: branch switcher + refresh + timestamp + bar toggle */}
            <div className="ml-auto flex items-center gap-2">
                <BranchSwitcher />
                {canView && lastUpdated && (
                    <span className="text-[10px] text-muted-foreground/60 hidden sm:block">
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
                        className={`text-muted-foreground/60 hover:text-foreground transition-colors ${recomputing ? "animate-spin" : ""}`}
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

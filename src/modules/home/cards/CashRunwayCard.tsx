"use client";

import { Hourglass } from "lucide-react";
import { formatInr } from "@/shared/lib/format/moneyInr";
import { HomeCard, useHomeData } from "./cardKit";

type Runway = { liquidFund: number; monthlyOut: number; months: number | null; runsOut: string | null };

/** The bar's scale tops out here — anything longer reads as "6+ months". */
const FULL_MONTHS = 6;

/** How many months cash + bank lasts if no money came in, at the last 3 months' money out. */
export default function CashRunwayCard() {
    const { data, failed, retry } = useHomeData<Runway>("/api/home/cash-runway");
    const months = data?.months ?? null;
    const tone =
        months == null ? "bg-emerald-500" :
        months < 1 ? "bg-red-500" :
        months < 3 ? "bg-amber-500" : "bg-emerald-500";
    const runsOut = data?.runsOut
        ? new Date(`${data.runsOut}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
        : null;

    return (
        <HomeCard icon={<Hourglass size={16} className="text-amber-600" />} title="Cash runway" failed={failed} onRetry={retry}>
            <p className="mt-3 font-mono text-3xl font-semibold text-foreground">
                {!data ? "…" : months == null ? "—" : months.toFixed(1)}
                <span className="ml-1.5 font-sans text-sm font-normal text-muted-foreground">months</span>
            </p>
            <p className="text-xs text-muted-foreground">How long cash + bank lasts if no money came in</p>

            <div className="mt-3 h-2 overflow-hidden rounded bg-muted">
                <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, ((months ?? FULL_MONTHS) / FULL_MONTHS) * 100)}%` }} />
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
                <span>0</span><span>3 mo</span><span>{FULL_MONTHS}+ mo</span>
            </div>

            {data && (
                <div className="mt-3 text-xs">
                    <Row label="Liquid fund today" value={formatInr(data.liquidFund, 0)} />
                    <Row label="Average money out a month (last 3 months)" value={formatInr(data.monthlyOut, 0)} />
                    <Row label="Runs out around" value={runsOut ?? "No money went out"} />
                </div>
            )}
        </HomeCard>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between gap-2 border-t border-border py-1.5">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono text-foreground">{value}</span>
        </div>
    );
}

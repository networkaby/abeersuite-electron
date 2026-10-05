"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { formatInr } from "@/shared/lib/format/moneyInr";

/** Day periods the dated cards offer. Mirrors HEALTH_PERIODS in modules/home/lib/businessHealth.ts (server-only). */
export const DAY_PERIODS = [
    { value: 7, label: "7 days" },
    { value: 15, label: "15 days" },
    { value: 30, label: "30 days" },
    { value: 90, label: "90 days" },
    { value: 365, label: "1 year" },
] as const;

/** Lakh / thousand shorthand for a big figure — tooltips show the exact amount. */
export function short(n: number): string {
    const a = Math.abs(n);
    const sign = n < 0 ? "−" : "";
    if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
    if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
    if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)} k`;
    return `${sign}₹${Math.round(a)}`;
}

export function signedInr(n: number): string {
    return `${n >= 0 ? "+" : "−"}${formatInr(Math.abs(n), 0)}`;
}

/** "21 Sep" — compact axis / summary date. */
export function dayLabel(iso: string): string {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

// One request per address for the whole page: cards reading the same figures
// (the three Business health cards, Cash flow and Runway) share it. A failure is
// dropped so Retry asks again.
const requests = new Map<string, Promise<unknown>>();
function load<T>(url: string): Promise<T> {
    let req = requests.get(url);
    if (!req) {
        req = axios.get<T>(url).then(({ data }) => data);
        req.catch(() => requests.delete(url));
        requests.set(url, req);
    }
    return req as Promise<T>;
}

/** Fetch a Home card's figures. Every address read this visit is kept, so switching back paints at once. */
export function useHomeData<T>(url: string) {
    const [byUrl, setByUrl] = useState<Record<string, T>>({});
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let live = true;
        load<T>(url)
            .then((data) => live && setByUrl((m) => ({ ...m, [url]: data })))
            .catch(() => live && setFailedUrl(url));
        return () => { live = false; };
    }, [url, attempt]);

    const data = byUrl[url];
    return {
        data,
        failed: failedUrl === url && data === undefined,
        retry: () => { setFailedUrl(null); setAttempt((n) => n + 1); },
    };
}

export function PeriodChips<V extends number>({
    options,
    value,
    onChange,
}: {
    options: readonly { value: V; label: string }[];
    value: V;
    onChange: (v: V) => void;
}) {
    return (
        <div className="flex flex-wrap gap-1">
            {options.map((p) => (
                <button
                    key={p.value}
                    type="button"
                    onClick={() => onChange(p.value)}
                    className={[
                        "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                        p.value === value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:bg-muted/60",
                    ].join(" ")}
                >
                    {p.label}
                </button>
            ))}
        </div>
    );
}

/** The frame every Home card shares: title row (with an optional control on the right), retry line, body. */
export function HomeCard({
    icon,
    title,
    control,
    failed,
    onRetry,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    control?: React.ReactNode;
    failed?: boolean;
    onRetry?: () => void;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    {icon}
                    <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                </div>
                {control}
            </div>
            {failed && (
                <p className="mt-3 text-xs text-red-600">
                    Couldn&apos;t load the figures.{" "}
                    <button type="button" onClick={onRetry} className="underline">Retry</button>
                </p>
            )}
            {children}
        </section>
    );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
    return (
        <div className="rounded bg-muted/40 px-2 py-1">
            <p className="text-muted-foreground">{label}</p>
            <p className="font-mono font-semibold text-foreground">
                {value} {note && <span className="font-sans font-normal text-muted-foreground">{note}</span>}
            </p>
        </div>
    );
}

"use client";

/** Stat tile — headline number with a small label (and optional sub-line). */
export function KpiCard({ label, value, sub, tone = "default" }: {
    label: string;
    value: string;
    sub?: string;
    tone?: "default" | "primary" | "negative";
}) {
    const valueClass =
        tone === "primary" ? "text-primary" :
        tone === "negative" ? "text-red-600" :
        "text-foreground";
    return (
        <div className={`rounded-lg border border-border p-3 shadow-sm ${tone === "primary" ? "bg-primary/10" : "bg-card"}`}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`mt-1 text-lg font-mono font-semibold ${valueClass}`}>{value}</div>
            {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
        </div>
    );
}

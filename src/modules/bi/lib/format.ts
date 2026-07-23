// Client-safe formatters for BI pages. Keep prisma-importing code out of here —
// marginEngine.ts is server-only; this file is imported by "use client" pages.

/** ₹ compact Indian notation for chart axes: 1.2Cr / 4.5L / 12K. */
export function fmtCompactINR(n: number): string {
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`;
    if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
    return `${sign}${abs.toFixed(0)}`;
}

export function fmtQty(n: number): string {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n);
}

export function fmtDate(s: string | null): string {
    if (!s) return "—";
    return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

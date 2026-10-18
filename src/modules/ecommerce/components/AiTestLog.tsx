"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { AI_SEARCH_MODES } from "@/shared/lib/constants/ai";
import { extractApiError } from "@/shared/lib/api";

// The AI search trial's results (2026-10-19), read from the pick log: per mode,
// how often search really ran, which version staff kept, and what it cost.
// Goes with AiAbCompare.tsx once the owner settles on one mode.

type Pick = {
    id: number;
    originalRef: string;
    action: "A" | "B" | "only";
    snapshot: {
        mode: string;
        search: string;
        verifiedFacts: number;
        tokens: { draft: number; search: number; polish: number };
        draftKey: string;
        ms: number;
    };
    createdAt: string;
};

const total = (p: Pick) => p.snapshot.tokens.draft + p.snapshot.tokens.search + p.snapshot.tokens.polish;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
const n = (x: number) => x.toLocaleString("en-IN");

export default function AiTestLog() {
    const [rows, setRows] = useState<Pick[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        axios.get<Pick[]>("/api/ecommerce/products/ai-copy/pick")
            .then(({ data }) => setRows(data))
            .catch((e) => setError(extractApiError(e, "Could not load the test log")));
    }, []);

    if (error) return <p className="text-destructive mt-2 text-sm">{error}</p>;
    if (!rows) return <p className="text-muted-foreground mt-2 text-sm">Loading…</p>;
    if (!rows.length) return <p className="text-muted-foreground mt-2 text-sm">No picks yet — generate some products and keep a version.</p>;

    return (
        <div className="mt-2 space-y-4 text-sm">
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="text-muted-foreground text-xs">
                        <tr>
                            <th className="p-1.5">Mode</th>
                            <th className="p-1.5">Products</th>
                            <th className="p-1.5">Search ran</th>
                            <th className="p-1.5">Kept A</th>
                            <th className="p-1.5">Kept B</th>
                            <th className="p-1.5">One version</th>
                            <th className="p-1.5">Avg facts</th>
                            <th className="p-1.5">Avg tokens</th>
                            <th className="p-1.5">Avg time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {AI_SEARCH_MODES.map((m) => {
                            const rs = rows.filter((r) => r.snapshot.mode === m.value);
                            if (!rs.length) return null;
                            const ran = rs.filter((r) => r.snapshot.tokens.search > 0).length;
                            return (
                                <tr key={m.value} className="border-t border-border">
                                    <td className="p-1.5 font-medium">{m.label}</td>
                                    <td className="p-1.5">{rs.length}</td>
                                    <td className="p-1.5">{ran} ({Math.round((ran / rs.length) * 100)}%)</td>
                                    <td className="p-1.5">{rs.filter((r) => r.action === "A").length}</td>
                                    <td className="p-1.5">{rs.filter((r) => r.action === "B").length}</td>
                                    <td className="p-1.5">{rs.filter((r) => r.action === "only").length}</td>
                                    <td className="p-1.5">{avg(rs.map((r) => r.snapshot.verifiedFacts))}</td>
                                    <td className="p-1.5">{n(avg(rs.map(total)))}</td>
                                    <td className="p-1.5">{(avg(rs.map((r) => r.snapshot.ms)) / 1000).toFixed(1)} s</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <details>
                <summary className="text-muted-foreground cursor-pointer text-xs">Every pick ({rows.length})</summary>
                <ul className="mt-1 space-y-0.5 text-xs">
                    {rows.map((r) => (
                        <li key={r.id}>
                            {new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })} · {r.originalRef} ·{" "}
                            {r.snapshot.mode} → {r.snapshot.search} · kept {r.action} · {r.snapshot.verifiedFacts} facts · {n(total(r))} tokens ({r.snapshot.draftKey} key)
                        </li>
                    ))}
                </ul>
            </details>
        </div>
    );
}

"use client";

import { useEffect, useState } from "react";
import { formatDateInput, indianFiscalYearStart } from "@/modules/accountancy/lib/period";

export type DatePreset = "today" | "yesterday" | "last7" | "thisMonth" | "thisFY" | "custom";

export function presetRange(p: DatePreset): { from: string; to: string } {
    const t = new Date();
    const f = (d: Date) => formatDateInput(d);
    switch (p) {
        case "today":     return { from: f(t), to: f(t) };
        case "yesterday": { const d = new Date(t); d.setDate(d.getDate() - 1); return { from: f(d), to: f(d) }; }
        case "last7":     { const d = new Date(t); d.setDate(d.getDate() - 6); return { from: f(d), to: f(t) }; }
        case "thisMonth": return { from: f(new Date(t.getFullYear(), t.getMonth(), 1)), to: f(t) };
        case "thisFY":    return { from: formatDateInput(indianFiscalYearStart()), to: f(t) };
        default:          return { from: "", to: "" };
    }
}

/** Client-side row filter. Generic so it works with extended row shapes (SalesRegister, etc.) */
export function applyRegisterFilters<T extends {
    date: string;
    reference: string;
    party: string | null;
    narration: string | null;
    status: string;
    deletedAt: string | null;
    branchId?: string | null;
}>(rows: T[], filters: {
    from: string;
    to: string;
    search: string;
    statuses: Set<string>;
    showDeleted: boolean;
    branchFilter?: string;
}): T[] {
    const { from, to, search, statuses, showDeleted, branchFilter } = filters;
    const q = search.toLowerCase();

    return rows.filter((r) => {
        const isDeleted = !!r.deletedAt;

        if (showDeleted) {
            if (!isDeleted) return false;
        } else {
            if (isDeleted) return false;
            if (statuses.size > 0) {
                const realStatuses = new Set([...statuses].filter((s) => s !== "DELETED"));
                if (realStatuses.size > 0 && !realStatuses.has(r.status)) return false;
            }
        }

        const d = r.date.slice(0, 10);
        if (from && d < from) return false;
        if (to   && d > to)   return false;

        if (branchFilter && branchFilter !== "__all__" && r.branchId !== branchFilter) return false;

        if (q && !r.reference.toLowerCase().includes(q)
              && !(r.narration ?? "").toLowerCase().includes(q)
              && !(r.party     ?? "").toLowerCase().includes(q)) return false;

        return true;
    });
}

export function useRegisterFilters(storageKey: string) {
    const get = (k: string): string | null => {
        try { return localStorage.getItem(k); } catch { return null; }
    };

    const [preset, setPresetState] = useState<DatePreset>(() => {
        return (get(`${storageKey}:preset`) as DatePreset | null) ?? "thisFY";
    });

    const [from, setFrom] = useState(() => {
        const p = (get(`${storageKey}:preset`) as DatePreset | null) ?? "thisFY";
        return p === "custom"
            ? (get(`${storageKey}:from`) ?? presetRange("thisFY").from)
            : presetRange(p).from;
    });

    const [to, setTo] = useState(() => {
        const p = (get(`${storageKey}:preset`) as DatePreset | null) ?? "thisFY";
        return p === "custom"
            ? (get(`${storageKey}:to`) ?? presetRange("thisFY").to)
            : presetRange(p).to;
    });

    const setPreset = (p: DatePreset) => {
        setPresetState(p);
        if (p !== "custom") { const r = presetRange(p); setFrom(r.from); setTo(r.to); }
    };
    const handleFrom = (v: string) => { setFrom(v); setPresetState("custom"); };
    const handleTo   = (v: string) => { setTo(v);   setPresetState("custom"); };

    const [search, setSearch] = useState(() => get(`${storageKey}:search`) ?? "");

    const [statuses, setStatuses] = useState<Set<string>>(() => {
        const saved = get(`${storageKey}:statuses`);
        try { return saved ? new Set(JSON.parse(saved) as string[]) : new Set(); }
        catch { return new Set(); }
    });

    const toggleStatus  = (s: string) =>
        setStatuses((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
    const clearStatuses = () => setStatuses(new Set());

    const showDeleted = statuses.has("DELETED");

    const [branchFilter, setBranchFilter] = useState<string>(
        () => get(`${storageKey}:branch`) ?? "__all__",
    );

    useEffect(() => { try { localStorage.setItem(`${storageKey}:preset`,   preset);                         } catch {} }, [storageKey, preset]);
    useEffect(() => { try { localStorage.setItem(`${storageKey}:from`,     from);                           } catch {} }, [storageKey, from]);
    useEffect(() => { try { localStorage.setItem(`${storageKey}:to`,       to);                             } catch {} }, [storageKey, to]);
    useEffect(() => { try { localStorage.setItem(`${storageKey}:search`,   search);                         } catch {} }, [storageKey, search]);
    useEffect(() => { try { localStorage.setItem(`${storageKey}:statuses`, JSON.stringify([...statuses])); } catch {} }, [storageKey, statuses]);
    useEffect(() => { try { localStorage.setItem(`${storageKey}:branch`,   branchFilter);                  } catch {} }, [storageKey, branchFilter]);

    const clearFilters = () => {
        setPreset("thisFY");
        setSearch("");
        setStatuses(new Set());
        setBranchFilter("__all__");
    };

    return {
        preset, setPreset,
        from, handleFrom,
        to, handleTo,
        search, setSearch,
        statuses, toggleStatus, clearStatuses,
        showDeleted,
        branchFilter, setBranchFilter,
        clearFilters,
    };
}

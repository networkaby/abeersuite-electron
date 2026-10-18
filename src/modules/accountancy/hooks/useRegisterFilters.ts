"use client";

import { useEffect, useMemo, useState } from "react";
import { indianFiscalYearStart } from "@/modules/accountancy/lib/period";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { presetRangeOf } from "@/shared/lib/format/datePresets";

export type DatePreset = "today" | "yesterday" | "last7" | "thisMonth" | "thisFY" | "custom";

/**
 * A financial year is this module's own idea, so it stays here; every other
 * preset is the shop-wide arithmetic in `shared/lib/format/datePresets.ts` and
 * is not written twice.
 */
export function presetRange(p: DatePreset): { from: string; to: string } {
    if (p === "thisFY") return { from: toIsoDate(indianFiscalYearStart()), to: toIsoDate(new Date()) };
    return presetRangeOf(p);
}

/** Client-side row filter. Generic so it works with extended row shapes (SalesRegister, etc.) */
export function applyRegisterFilters<T extends {
    date: string;
    reference: string;
    party: string | null;
    narration: string | null;
    status: string;
    branchId?: string | null;
}>(rows: T[], filters: {
    from: string;
    to: string;
    search: string;
    statuses: Set<string>;
    branchFilter?: string;
}): T[] {
    const { from, to, search, statuses, branchFilter } = filters;
    const q = search.toLowerCase();

    return rows.filter((r) => {
        if (statuses.size > 0 && !statuses.has(r.status)) return false;

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

type RegisterRow = Parameters<typeof applyRegisterFilters>[0][number];
type RegisterFilterValues = Parameters<typeof applyRegisterFilters>[1];

/** `applyRegisterFilters`, memoised on every filter field it reads. The filters
 *  object is new each render, so callers used to list its fields by hand — and
 *  two registers forgot `branchFilter`, leaving the Branch box with no effect.
 *  Listing them once here keeps every register in step. */
export function useFilteredRegister<T extends RegisterRow>(rows: T[], filters: RegisterFilterValues): T[] {
    const { from, to, search, statuses, branchFilter } = filters;
    return useMemo(
        () => applyRegisterFilters(rows, { from, to, search, statuses, branchFilter }),
        [rows, from, to, search, statuses, branchFilter],
    );
}

/**
 * @param defaultPreset  the period a first-time visitor lands on. Registers open
 *   on the whole FY because you go there to look something up; the Day Book opens
 *   on TODAY because you go there to see what just happened — and because a
 *   year-wide default invites pulling a year of rows before the user has asked
 *   for any of it.
 */
export function useRegisterFilters(storageKey: string, defaultPreset: DatePreset = "thisFY") {
    const get = (k: string): string | null => {
        try { return localStorage.getItem(k); } catch { return null; }
    };

    const [preset, setPresetState] = useState<DatePreset>(() => {
        return (get(`${storageKey}:preset`) as DatePreset | null) ?? defaultPreset;
    });

    const [from, setFrom] = useState(() => {
        const p = (get(`${storageKey}:preset`) as DatePreset | null) ?? defaultPreset;
        return p === "custom"
            ? (get(`${storageKey}:from`) ?? presetRange(defaultPreset).from)
            : presetRange(p).from;
    });

    const [to, setTo] = useState(() => {
        const p = (get(`${storageKey}:preset`) as DatePreset | null) ?? defaultPreset;
        return p === "custom"
            ? (get(`${storageKey}:to`) ?? presetRange(defaultPreset).to)
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
        try {
            // "DELETED" was a status option until soft-delete was removed (2026-08-01).
            // It still sits in the localStorage of anyone who had ticked it, and it
            // matches no row — leaving it in would silently show them an empty
            // register forever. Drop it on hydrate.
            const parsed = saved ? (JSON.parse(saved) as string[]) : [];
            return new Set(parsed.filter((s) => s !== "DELETED"));
        }
        catch { return new Set(); }
    });

    const toggleStatus  = (s: string) =>
        setStatuses((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });
    const clearStatuses = () => setStatuses(new Set());

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
        setPreset(defaultPreset);
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
        branchFilter, setBranchFilter,
        clearFilters,
    };
}

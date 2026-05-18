"use client";

import { create } from "zustand";

const STORAGE_KEY = "app:active-branch";
const COOKIE_NAME = "app:active-branch";

/**
 * Sentinel branch id meaning "all branches the user has access to."
 * Reports use this to render a consolidated/union view. Transaction APIs
 * reject it with `select_working_branch` because writes need a concrete
 * operational branch.
 */
export const COMBINED_BRANCH = "__combined__";

export function isCombined(id: string | null | undefined): boolean {
    return id === COMBINED_BRANCH;
}

interface ActiveBranchStore {
    activeBranchId: string | null;
    setActiveBranchId: (id: string | null) => void;
    /** Hydrate from localStorage / cookie / first session branch on first render. */
    hydrate: (fallback: string | null) => void;
}

export const useActiveBranchStore = create<ActiveBranchStore>((set, get) => ({
    activeBranchId: null,
    setActiveBranchId: (id) => {
        if (typeof window !== "undefined") {
            try {
                if (id) {
                    localStorage.setItem(STORAGE_KEY, id);
                    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(id)}; path=/; max-age=31536000; SameSite=Lax`;
                } else {
                    localStorage.removeItem(STORAGE_KEY);
                    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
                }
            } catch { /* ignore */ }
        }
        set({ activeBranchId: id });
    },
    hydrate: (fallback) => {
        if (typeof window === "undefined") return;
        if (get().activeBranchId) return;
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            const next = stored || fallback;
            if (next) {
                document.cookie = `${COOKIE_NAME}=${encodeURIComponent(next)}; path=/; max-age=31536000; SameSite=Lax`;
                set({ activeBranchId: next });
            }
        } catch { /* ignore */ }
    },
}));

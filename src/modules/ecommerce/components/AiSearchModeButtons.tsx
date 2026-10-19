"use client";

import { useSyncExternalStore } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AI_SEARCH_MODES, type AiSearchMode } from "@/shared/lib/constants/ai";

// AI controls shared by the product form and the bulk screen: the search mode
// and the "Use Premium API" switch (owner, 2026-10-19 — off by default so the
// paid key is never spent unknowingly; online search needs it).

const PREMIUM_KEY = "ai-premium-api";

const listeners = new Set<() => void>();
function readPremium(): boolean {
    try { return localStorage.getItem(PREMIUM_KEY) === "1"; } catch { return false; } // blocked storage → off
}
function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

/** The Premium choice, remembered on this PC; the server render reads No. */
export function usePremiumAi(): [boolean, (on: boolean) => void] {
    const premium = useSyncExternalStore(subscribe, readPremium, () => false);
    const set = (on: boolean) => {
        try { localStorage.setItem(PREMIUM_KEY, on ? "1" : "0"); } catch { /* blocked — stays off */ }
        listeners.forEach((fn) => fn());
    };
    return [premium, set];
}

export function PremiumSwitch({ value, onChange, disabled }: { value: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
    return (
        <div className="flex items-center gap-2">
            <Switch id="ai-premium" checked={value} onCheckedChange={onChange} disabled={disabled} />
            <Label htmlFor="ai-premium" className="text-sm">
                Use Premium API: <b>{value ? "Yes" : "No"}</b>
            </Label>
        </div>
    );
}

/** Off · When it helps · Always. Without Premium it reads Off and is locked. */
export function SearchModeButtons({ value, onChange, disabled, premium }: {
    value: AiSearchMode;
    onChange: (v: AiSearchMode) => void;
    disabled?: boolean;
    premium: boolean;
}) {
    const shown = premium ? value : "off";
    return (
        <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">Search online:</span>
            <div role="radiogroup" aria-label="Search online" className="inline-flex rounded-md border border-border p-0.5">
                {AI_SEARCH_MODES.map((m) => (
                    <button
                        key={m.value}
                        type="button"
                        role="radio"
                        aria-checked={shown === m.value}
                        disabled={disabled || !premium}
                        onClick={() => onChange(m.value)}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                            shown === m.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                        }`}
                    >
                        {m.label}
                    </button>
                ))}
            </div>
            {!premium && <span className="text-muted-foreground text-xs">needs Premium</span>}
        </div>
    );
}

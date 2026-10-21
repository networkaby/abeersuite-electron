"use client";

import { useSyncExternalStore } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AI_COPY_FLOWS, AI_DEFAULT_COPY_FLOW, type AiCopyFlow } from "@/shared/lib/constants/ai";

// AI controls shared by the product form and the bulk screen: the "Use
// Premium API" switch (owner, 2026-10-19 — off by default so a paid key is
// never spent unknowingly) and the flow, Direct AI or Verified (2026-10-21).
// Both are remembered on this PC; the flow last picked is this PC's default.

const PREMIUM_KEY = "ai-premium-api";
const FLOW_KEY = "ai-copy-flow";

const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}
function read(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; } // blocked storage → defaults
}
function write(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* blocked — not remembered */ }
    listeners.forEach((fn) => fn());
}

/** The Premium choice, remembered on this PC; the server render reads No. */
export function usePremiumAi(): [boolean, (on: boolean) => void] {
    const premium = useSyncExternalStore(subscribe, () => read(PREMIUM_KEY) === "1", () => false);
    return [premium, (on) => write(PREMIUM_KEY, on ? "1" : "0")];
}

const readFlow = (): AiCopyFlow => {
    const v = read(FLOW_KEY);
    return AI_COPY_FLOWS.some((f) => f.value === v) ? (v as AiCopyFlow) : AI_DEFAULT_COPY_FLOW;
};

/** Direct AI or Verified, remembered on this PC. */
export function useCopyFlow(): [AiCopyFlow, (f: AiCopyFlow) => void] {
    const flow = useSyncExternalStore(subscribe, readFlow, () => AI_DEFAULT_COPY_FLOW);
    return [flow, (f) => write(FLOW_KEY, f)];
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

/** Direct AI · Verified. */
export function FlowButtons({ value, onChange, disabled }: { value: AiCopyFlow; onChange: (f: AiCopyFlow) => void; disabled?: boolean }) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">Write with:</span>
            <div role="radiogroup" aria-label="Write with" className="inline-flex rounded-md border border-border p-0.5">
                {AI_COPY_FLOWS.map((f) => (
                    <button
                        key={f.value}
                        type="button"
                        role="radio"
                        aria-checked={value === f.value}
                        disabled={disabled}
                        title={f.hint}
                        onClick={() => onChange(f.value)}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                            value === f.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                        }`}
                    >
                        {f.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

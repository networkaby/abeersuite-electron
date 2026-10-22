"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AI_COPY_FLOWS, AI_DEFAULT_COPY_FLOW, type AiCopyFlow } from "@/shared/lib/constants/ai";

// AI controls shared by the product form and the bulk screen: the "Use
// Premium API" switch (owner, 2026-10-19 — off by default so a paid key is
// never spent unknowingly) and the flow, Direct AI or Verified (2026-10-21).
// Premium is remembered on this PC. The flow always opens on the admin's pick
// (Settings → AI Setup, read once per page load); picking the other one lasts
// only while this screen is open (owner, 2026-10-22).

const PREMIUM_KEY = "ai-premium-api";

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

let adminFlow: AiCopyFlow = AI_DEFAULT_COPY_FLOW;
let adminPhotoCheck = false;
let adminFlowAsked = false;
/** One read per page load; a failure keeps the built-in fallback. */
function askAdminFlow() {
    if (adminFlowAsked) return;
    adminFlowAsked = true;
    void fetch("/api/ecommerce/products/ai-copy")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { defaultFlow?: string; photoCheck?: boolean } | null) => {
            const f = AI_COPY_FLOWS.find((x) => x.value === d?.defaultFlow);
            if (f) adminFlow = f.value;
            adminPhotoCheck = d?.photoCheck === true;
            listeners.forEach((fn) => fn());
        })
        .catch(() => undefined);
}

/** Verified's Photo AI switch on AI Setup (read with the admin's flow, same request). */
export function usePhotoAiOn(): boolean {
    useEffect(askAdminFlow, []);
    return useSyncExternalStore(subscribe, () => adminPhotoCheck, () => false);
}

/** Direct AI or Verified: opens on the admin's pick; another pick lasts only while this screen is open. */
export function useCopyFlow(): [AiCopyFlow, (f: AiCopyFlow) => void] {
    useEffect(askAdminFlow, []);
    const preferred = useSyncExternalStore(subscribe, () => adminFlow, () => AI_DEFAULT_COPY_FLOW);
    const [picked, setPicked] = useState<AiCopyFlow | null>(null);
    return [picked ?? preferred, setPicked];
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

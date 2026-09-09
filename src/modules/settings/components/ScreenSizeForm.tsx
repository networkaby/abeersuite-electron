"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { isElectronEnvironment } from "@/shared/lib/bridge";
import { Monitor, Wand2, Loader2, Minus, Plus } from "lucide-react";

/** 0.8 → "80%". Kept out of the buttons so the badge and the labels can never disagree. */
function asPercent(factor: number): string {
    return `${Math.round(factor * 100)}%`;
}

/**
 * The slider's range, in percent. Mirrors MIN_ZOOM / MAX_ZOOM in
 * electron/displayPreference.ts — main clamps to the same bounds, so a value
 * outside them could never be applied anyway. 5% is one nudge of the − / + buttons.
 */
const MIN_PCT = 50;
const MAX_PCT = 150;
const STEP_PCT = 5;

const clampPct = (pct: number) => Math.min(MAX_PCT, Math.max(MIN_PCT, Math.round(pct / STEP_PCT) * STEP_PCT));

interface Setting {
    mode: "auto" | "fixed";
    applied: number;
    steps?: number[];
}

export function ScreenSizeForm() {
    const [setting, setSetting] = useState<Setting | null>(null);
    const [busy, setBusy] = useState(false);
    // What the slider shows while it is being dragged. Applying on every pixel of a
    // drag would make the whole window jitter, so the size is sent on release; the
    // number beside the slider still follows the thumb so the user sees where it is.
    const [draft, setDraft] = useState<number | null>(null);
    const inElectron = isElectronEnvironment();

    useEffect(() => {
        if (!inElectron) return;
        void window.electronAPI?.display.get().then(setSetting);
    }, [inElectron]);

    const choose = useCallback(async (mode: "auto" | "fixed", factor?: number) => {
        setBusy(true);
        try {
            const next = await window.electronAPI?.display.set(mode, factor);
            if (!next) return;
            // `steps` only comes back from `get`, so carry the existing list forward
            // rather than blanking the buttons the moment one of them is pressed.
            setSetting((prev) => ({ ...next, steps: prev?.steps }));
            toast.success(
                mode === "auto"
                    ? `Automatic — this screen is now at ${asPercent(next.applied)}`
                    : `Screen size set to ${asPercent(next.applied)}`,
            );
        } catch {
            toast.error("Could not change the screen size.");
        } finally {
            setBusy(false);
            setDraft(null);
        }
    }, []);

    if (!inElectron) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Screen Size</CardTitle>
                    <CardDescription>
                        This setting belongs to the installed AbeerSuite app, which draws its own
                        window. In a web browser, use the browser&apos;s own zoom instead
                        (Ctrl and &minus;, Ctrl and +).
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    if (!setting) {
        return (
            <Card>
                <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reading this PC&apos;s screen…
                </CardContent>
            </Card>
        );
    }

    const steps = setting.steps ?? [];
    const appliedPct = Math.round(setting.applied * 100);
    const shownPct = draft ?? appliedPct;
    const nudge = (delta: number) => choose("fixed", clampPct(appliedPct + delta) / 100);

    return (
        <Card>
            <CardHeader>
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Monitor className="h-4 w-4" />
                            Screen Size
                        </CardTitle>
                        <CardDescription className="mt-1">
                            How large the app draws itself on this PC. A smaller size fits more of a
                            page on a counter screen, so fewer scrollbars appear; a larger one is
                            easier on the eyes. This is saved on this PC only — every counter can
                            have its own.
                        </CardDescription>
                    </div>
                    <Badge variant="secondary" className="shrink-0 tabular-nums">
                        Now {asPercent(setting.applied)}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="space-y-5">
                <div className="space-y-2">
                    <Button
                        type="button"
                        variant={setting.mode === "auto" ? "default" : "outline"}
                        disabled={busy}
                        onClick={() => choose("auto")}
                        className="h-auto w-full justify-start gap-3 py-3 text-left"
                    >
                        <Wand2 className="h-4 w-4 shrink-0" />
                        <span className="flex flex-col items-start">
                            <span className="font-medium">Automatic (recommended)</span>
                            <span className="text-[11px] font-normal opacity-80">
                                Chosen from this screen&apos;s width. On this PC that comes to{" "}
                                {asPercent(setting.applied)}.
                            </span>
                        </span>
                    </Button>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Or set it yourself</p>
                        {setting.mode === "fixed" && (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => choose("auto")}
                                className="text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                            >
                                Back to Automatic
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label="Smaller"
                            disabled={busy || appliedPct <= MIN_PCT}
                            onClick={() => nudge(-STEP_PCT)}
                        >
                            <Minus className="h-4 w-4" />
                        </Button>
                        <div className="flex flex-1 flex-col items-center gap-1">
                            <span className="text-2xl font-semibold tabular-nums leading-none">
                                {shownPct}%
                            </span>
                            <input
                                type="range"
                                aria-label="Screen size"
                                min={MIN_PCT}
                                max={MAX_PCT}
                                step={STEP_PCT}
                                value={shownPct}
                                disabled={busy}
                                onChange={(e) => setDraft(Number(e.target.value))}
                                // Apply once the thumb is let go — mouse, touch or keyboard alike.
                                onPointerUp={() => draft != null && draft !== appliedPct && void choose("fixed", draft / 100)}
                                onKeyUp={() => draft != null && draft !== appliedPct && void choose("fixed", draft / 100)}
                                className="w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            <div className="flex w-full justify-between text-[10px] text-muted-foreground tabular-nums">
                                <span>{MIN_PCT}%</span>
                                <span>100%</span>
                                <span>{MAX_PCT}%</span>
                            </div>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label="Larger"
                            disabled={busy || appliedPct >= MAX_PCT}
                            onClick={() => nudge(STEP_PCT)}
                        >
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>

                    {steps.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {steps.map((step) => {
                                const active = setting.mode === "fixed" && Math.abs(setting.applied - step) < 0.001;
                                return (
                                    <Button
                                        key={step}
                                        type="button"
                                        size="sm"
                                        variant={active ? "default" : "outline"}
                                        disabled={busy}
                                        onClick={() => choose("fixed", step)}
                                        className="tabular-nums"
                                    >
                                        {asPercent(step)}
                                    </Button>
                                );
                            })}
                        </div>
                    )}

                    <p className="text-[11px] text-muted-foreground">
                        The change happens straight away, so you can look at a busy page while you
                        try the sizes. Ctrl and + / Ctrl and &minus; on the keyboard do the same
                        thing, and Ctrl and 0 puts it back to Automatic.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { isElectronEnvironment } from "@/shared/lib/bridge";
import { Monitor, Wand2, Loader2 } from "lucide-react";

/** 0.8 → "80%". Kept out of the buttons so the badge and the labels can never disagree. */
function asPercent(factor: number): string {
    return `${Math.round(factor * 100)}%`;
}

interface Setting {
    mode: "auto" | "fixed";
    applied: number;
    steps?: number[];
}

export function ScreenSizeForm() {
    const [setting, setSetting] = useState<Setting | null>(null);
    const [busy, setBusy] = useState(false);
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
                            page on a counter screen, so fewer scrollbars appear. This is saved on
                            this PC only — every counter can have its own.
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

                <div className="space-y-2">
                    <p className="text-sm font-medium">Or fix it yourself</p>
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

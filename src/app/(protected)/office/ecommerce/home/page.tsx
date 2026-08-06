"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowUp, ArrowDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    DEFAULT_HOME_LAYOUT,
    HOME_SECTION_LABELS,
    type HomeSectionConfig,
} from "@/shared/lib/shop/homeLayout";

// Retry transient GET failures (dev-compile hiccups) so the page reflects the
// real saved order instead of silently falling back to defaults, which could
// then get saved over the owner's real layout.
async function getWithRetry<T>(url: string, tries = 3, delayMs = 400): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < tries; i++) {
        try {
            return (await axios.get<T>(url)).data;
        } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
    throw lastErr;
}

/**
 * Customize Home — on/off + reorder for the storefront home page's existing
 * sections. No new section types here; this only decides which of the
 * sections the code already knows how to render show up, and in what order.
 * See src/shared/lib/shop/homeLayout.ts for the section catalogue.
 */
export default function CustomizeHomePage() {
    const [layout, setLayout] = useState<HomeSectionConfig[]>(DEFAULT_HOME_LAYOUT);
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoadError(false);
        try {
            const data = await getWithRetry<{ layout: HomeSectionConfig[] }>("/api/ecommerce/home-layout");
            setLayout(data.layout);
            setLoaded(true);
        } catch {
            setLoadError(true);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const move = (index: number, dir: -1 | 1) => {
        setLayout((rows) => {
            const target = index + dir;
            if (target < 0 || target >= rows.length) return rows;
            const next = [...rows];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const toggle = (key: HomeSectionConfig["key"], enabled: boolean) => {
        setLayout((rows) => rows.map((r) => (r.key === key ? { ...r, enabled } : r)));
    };

    const save = async () => {
        setSaving(true);
        try {
            const { data } = await axios.put<{ layout: HomeSectionConfig[] }>("/api/ecommerce/home-layout", {
                layout,
            });
            setLayout(data.layout);
            toast.success("Home page layout saved");
        } catch {
            toast.error("Failed to save layout");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mx-auto max-w-2xl space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight">Customize home</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Turn storefront home page sections on or off, and reorder them. Changes apply to{" "}
                        <span className="font-medium">/</span> for every customer.
                    </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                    <Link href="/" target="_blank" rel="noopener noreferrer">
                        View storefront
                        <ExternalLink className="ml-1.5 size-3.5" aria-hidden />
                    </Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Sections</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {loadError ? (
                        <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
                            <span className="text-destructive">Couldn’t load the current layout.</span>
                            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                                Retry
                            </Button>
                        </div>
                    ) : (
                        <>
                            {layout.map((section, i) => {
                                const meta = HOME_SECTION_LABELS[section.key];
                                return (
                                    <div
                                        key={section.key}
                                        className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5"
                                    >
                                        <div className="flex flex-col">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="size-6"
                                                disabled={!loaded || saving || i === 0}
                                                onClick={() => move(i, -1)}
                                                aria-label={`Move ${meta.label} up`}
                                            >
                                                <ArrowUp className="size-3.5" aria-hidden />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="size-6"
                                                disabled={!loaded || saving || i === layout.length - 1}
                                                onClick={() => move(i, 1)}
                                                aria-label={`Move ${meta.label} down`}
                                            >
                                                <ArrowDown className="size-3.5" aria-hidden />
                                            </Button>
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <Label htmlFor={`section-${section.key}`} className="font-normal">
                                                {meta.label}
                                            </Label>
                                            <p className="text-xs text-muted-foreground">{meta.hint}</p>
                                        </div>

                                        <Switch
                                            id={`section-${section.key}`}
                                            checked={section.enabled}
                                            disabled={!loaded || saving}
                                            onCheckedChange={(v) => toggle(section.key, v)}
                                        />
                                    </div>
                                );
                            })}

                            <div className="flex items-center justify-end gap-3 pt-1">
                                {!loaded ? <span className="text-xs text-muted-foreground">Loading…</span> : null}
                                <Button type="button" onClick={() => void save()} disabled={!loaded || saving}>
                                    {saving ? "Saving…" : "Save layout"}
                                </Button>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

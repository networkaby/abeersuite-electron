"use client";

import { cn } from "@/shared/lib/format/utils";
import {
    AD_SPOT_DEFS,
    adSizeDef,
    adSizePx,
    isAdLive,
    type AdSize,
    type AdSpot,
    type ShopAd,
} from "@/shared/lib/shop/ads";

/** One numbered spot on the wireframe — blue when a live ad can fill it today, amber when nothing fits. */
function SpotTag({ spot, liveCount, className }: { spot: AdSpot; liveCount: number; className?: string }) {
    const index = AD_SPOT_DEFS.findIndex((d) => d.spot === spot);
    const def = AD_SPOT_DEFS[index];
    return (
        <div
            className={cn(
                "flex items-center justify-center gap-1 rounded border border-dashed text-[10px] font-medium",
                liveCount > 0 ? "border-primary/60 bg-primary/10 text-primary" : "border-amber-400 bg-amber-50 text-amber-700",
                className,
            )}
            title={`${def.label} — ${def.sizes.map((s) => adSizeDef(s).label).join(" / ")}`}
        >
            <span className="rounded-full bg-current/15 px-1">{index + 1}</span>
            {def.label}
        </div>
    );
}

/**
 * Where ads show, page by page: a wireframe of the catalog with the spots
 * numbered, and the full list with how many live ads can fill each one right
 * now. Zero on a spot means it stays blank for customers today.
 */
export default function SpotMap({ ads, todayIso }: { ads: ShopAd[]; todayIso: string }) {
    const live = ads.filter((a) => isAdLive(a, todayIso));
    const countFor = (sizes: AdSize[]) => live.filter((a) => a.sizes.some((s) => sizes.includes(s))).length;
    const countAt = (spot: AdSpot) => countFor(AD_SPOT_DEFS.find((d) => d.spot === spot)!.sizes);

    return (
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
            {/* Catalog wireframe — the page where most spots live. */}
            <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Catalog page</p>
                <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-2 text-[10px] text-muted-foreground">
                    <div className="h-4 rounded bg-muted" />
                    <SpotTag spot="catalogTop" liveCount={countAt("catalogTop")} className="h-6" />
                    <div className="flex gap-1.5">
                        <div className="w-16 space-y-1.5">
                            <div className="h-16 rounded bg-muted" />
                            <SpotTag spot="sidebarRect" liveCount={countAt("sidebarRect")} className="h-10 flex-col gap-0" />
                            <SpotTag spot="sidebarTall" liveCount={countAt("sidebarTall")} className="h-20 flex-col gap-0" />
                        </div>
                        <div className="flex-1 space-y-1.5">
                            <div className="grid grid-cols-3 gap-1">
                                <div className="h-10 rounded bg-muted" />
                                <div className="h-10 rounded bg-muted" />
                                <SpotTag spot="gridFill" liveCount={countAt("gridFill")} className="h-10 flex-col gap-0" />
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                                <div className="h-10 rounded bg-muted" />
                                <SpotTag spot="gridFill" liveCount={countAt("gridFill")} className="col-span-2 h-10" />
                            </div>
                            <SpotTag spot="catalogBetween" liveCount={countAt("catalogBetween")} className="h-6" />
                            <div className="grid grid-cols-3 gap-1">
                                <div className="h-10 rounded bg-muted" />
                                <div className="h-10 rounded bg-muted" />
                                <div className="h-10 rounded bg-muted" />
                            </div>
                        </div>
                    </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                    Blue: a live ad can fill it today. Amber: nothing fits — customers see the page as before.
                </p>
            </div>

            <ul className="divide-y divide-border rounded-lg border border-border">
                {AD_SPOT_DEFS.map((d, i) => {
                    const n = countFor(d.sizes);
                    return (
                        <li key={d.spot} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
                                {i + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="font-medium">
                                    {d.label}
                                    <span className="ml-2 text-xs font-normal text-muted-foreground">{d.page}</span>
                                </p>
                                <p className="text-xs text-muted-foreground">{d.hint}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    Takes {d.sizes.map((s) => `${adSizeDef(s).label} ${adSizePx(s)}`).join(", then ")}
                                </p>
                            </div>
                            <span
                                className={cn(
                                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                                    n > 0 ? "bg-primary/10 text-primary" : "bg-amber-50 text-amber-700",
                                )}
                            >
                                {n} live
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

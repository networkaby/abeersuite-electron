"use client";

import { useMemo } from "react";
import AdUnit from "@/modules/external/shop/ads/AdUnit";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";
import { AdPicker, adIncompleteReason, adSizeDef, adSizePx, type AdSize, type ShopAd } from "@/shared/lib/shop/ads";

/**
 * On-screen width each size is drawn at, roughly what the shop gives it on a
 * desktop; the two grid sizes also need a row height. Billboard is zoomed
 * down to fit the column.
 */
const PREVIEW_BOX: Record<AdSize, { width: number; height?: number; zoom?: number }> = {
    tile: { width: 280, height: 360 },
    wide: { width: 584, height: 360 },
    billboard: { width: 970, zoom: 0.6 },
    rectangle: { width: 300 },
    halfPage: { width: 300 },
    mobile: { width: 320 },
};

/**
 * The selected ad drawn at every size it may fill — through the same picker
 * and the same `AdUnit` the shop uses, so what you see here is what a
 * customer gets. Ignores the ad's switch and dates on purpose: you are
 * looking at the artwork, not the schedule.
 */
export default function AdPreview({
    ad,
    products,
    todayIso,
}: {
    ad: ShopAd;
    products: ShopProductPublic[];
    todayIso: string;
}) {
    const reason = adIncompleteReason(ad);
    const units = useMemo(() => {
        if (reason) return [];
        return ad.sizes.map((size) => {
            // A fresh picker per size: the real one never hands out an ad twice.
            const picker = new AdPicker([{ ...ad, enabled: true, startAt: undefined, endAt: undefined }], {
                todayIso,
                products,
                seed: 0,
                maxPerPage: 1,
            });
            return { size, resolved: picker.pickSize(size, ad.category) };
        });
    }, [ad, products, todayIso, reason]);

    if (reason) {
        return (
            <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                {reason} — fill it in to see the preview.
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {units.map(({ size, resolved }) => {
                const box = PREVIEW_BOX[size];
                const def = adSizeDef(size);
                return (
                    <div key={size} className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                            {def.label}
                            <span className="ml-1.5 font-normal">
                                {def.standard} · {adSizePx(size)}
                            </span>
                        </p>
                        {resolved ? (
                            <div className="overflow-auto rounded-md border border-border bg-background p-3">
                                <div style={{ zoom: box.zoom ?? 1 }}>
                                    <div style={{ width: box.width, height: box.height }}>
                                        <AdUnit ad={resolved} />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
                                No product matches this rule right now, so this size would stay empty.
                            </p>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

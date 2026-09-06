"use client";

import { bridgeOk, bridgeRequest, thermalPrinterConfigured } from "@/shared/lib/bridge/hardwareBridge";
import { voucherPrintPageHref, type VoucherSource } from "@/modules/accountancy/lib/voucherUrls";

/**
 * Silent thermal print of a Day-Book voucher — the way a POS sale prints:
 * no page, no dialog. Fetches the bridge payload from
 * `/api/print/thermal/[source]/[id]` and sends it over the bridge.
 *
 * Returns false (never throws) when the counter cannot print silently — no
 * bridge, no printer of any type in Printer Settings, or the send failed — so
 * the caller can fall back to the format-selection page.
 */
export async function printVoucherThermalSilently(source: VoucherSource, rawId: number): Promise<boolean> {
    try {
        if (!await bridgeOk("thermal", 1200)) return false;
        if (!await thermalPrinterConfigured()) return false;
        const res = await fetch(`/api/print/thermal/${source}/${rawId}`, { cache: "no-store" });
        if (!res.ok) return false;
        const { cmd, payload } = (await res.json()) as { cmd: string; payload: unknown };
        await bridgeRequest("thermal", cmd, payload);
        return true;
    } catch {
        return false;
    }
}

/**
 * "Print after save" for the voucher forms, per the form's Thermal tick:
 *   • Thermal ON  → silent thermal print, like a POS sale (no tab). Only when
 *     the counter cannot print silently does the format-selection page open,
 *     on the 80mm view.
 *   • Thermal OFF → the format-selection page (browser print dialog).
 */
export async function printVoucherAfterSave(source: VoucherSource, rawId: number, opts: { thermal: boolean }): Promise<void> {
    if (opts.thermal && await printVoucherThermalSilently(source, rawId)) return;
    const url = voucherPrintPageHref(source, rawId) + (opts.thermal ? "&paper=THERMAL_80MM" : "");
    window.open(url, "_blank", "noopener");
}

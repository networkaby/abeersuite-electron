"use client";

import { bridgeOk, bridgeRequest, thermalPrinterConfigured } from "@/shared/lib/bridge/hardwareBridge";
import { toast } from "sonner";
import { receiptHref, voucherPrintPageHref, type VoucherSource } from "@/modules/accountancy/lib/voucherUrls";

/**
 * `openDrawer` — the counter just took or paid out cash for this voucher (a
 * fresh Rcv, Exp, cash refund or order advance), so the slip also opens the
 * cash drawer, if Printer Settings says this PC has one. Never set on a reprint.
 */
type ThermalPrintOpts = { openDrawer?: boolean };

/**
 * Open the cash drawer with no slip — cash moved but nothing is printing (a bill
 * saved with Print off, a shift opened with float, the Close Shift count). Only
 * when Printer Settings has the cash-drawer tick on this PC. Never throws, never
 * toasts: a counter without a drawer simply does nothing.
 */
export async function openCashDrawer(): Promise<void> {
    try {
        if (!await bridgeOk("thermal", 1200)) return;
        const cfg = await bridgeRequest<{ cashDrawer?: boolean }>("thermal", "config:get", undefined, 1500);
        if (!cfg?.cashDrawer) return;
        await bridgeRequest("thermal", "drawer:open");
    } catch {
        // No drawer / bridge gone — the sale is already saved, stay quiet.
    }
}

/**
 * Silent thermal print of a Day-Book voucher — the way a POS sale prints:
 * no page, no dialog. Fetches the bridge payload from
 * `/api/print/thermal/[source]/[id]` and sends it over the bridge.
 *
 * Returns false (never throws) when the counter cannot print silently — no
 * bridge, no printer of any type in Printer Settings, or the send failed — so
 * the caller can fall back to the format-selection page.
 */
export async function printVoucherThermalSilently(source: VoucherSource, rawId: number, opts: ThermalPrintOpts = {}): Promise<boolean> {
    try {
        if (!await bridgeOk("thermal", 1200)) return false;
        if (!await thermalPrinterConfigured()) return false;
        const res = await fetch(`/api/print/thermal/${source}/${rawId}`, { cache: "no-store" });
        if (!res.ok) return false;
        const { cmd, payload } = (await res.json()) as { cmd: string; payload: object };
        await bridgeRequest("thermal", cmd, opts.openDrawer ? { ...payload, openDrawer: true } : payload);
        return true;
    } catch {
        return false;
    }
}

/**
 * "Print (thermal)" for a saved voucher — reprint buttons, 3-dot menus, the
 * POS Rcv / Exp dialogs: silent bridge print like a POS sale, no tab. Only when
 * the counter cannot print silently does the format-selection page open (on
 * the 80mm view). `kind` picks the page: POS / ONLINE_INVOICE → the invoice
 * page, RECEIPT / PAYMENT → the payment slip, anything else → generic.
 */
export async function printVoucherThermal(source: VoucherSource, rawId: number, kind: string, opts: ThermalPrintOpts = {}): Promise<void> {
    if (await printVoucherThermalSilently(source, rawId, opts)) {
        toast.success("Sent to thermal printer");
        return;
    }
    // The slip could not carry the kick — still open the drawer for the cash.
    if (opts.openDrawer) void openCashDrawer();
    window.open(`${receiptHref(source, rawId, kind, "pdf")}&paper=THERMAL_80MM`, "_blank", "noopener");
}

/**
 * Print a voucher the POS just saved, by the POS sale's rule: bridge there → the
 * slip goes straight to it and a failure is only a toast; no bridge → the 80mm
 * page. `payload` is the slip from the save's own answer; an older server sends
 * none, and then it is read from the print API.
 */
export async function printSavedVoucherThermal(
    source: VoucherSource, rawId: number, kind: string, payload: object | null | undefined, opts: ThermalPrintOpts = {},
): Promise<void> {
    if (!await bridgeOk("thermal", 1200)) {
        window.open(`${receiptHref(source, rawId, kind, "pdf")}&paper=THERMAL_80MM`, "_blank", "noopener");
        return;
    }
    if (payload) {
        try {
            await bridgeRequest("thermal", "print/voucher", opts.openDrawer ? { ...payload, openDrawer: true } : payload);
            return;
        } catch { /* reported below */ }
    } else if (await printVoucherThermalSilently(source, rawId, opts)) {
        return;
    }
    if (opts.openDrawer) void openCashDrawer();
    toast.error("Saved, but thermal print failed", {
        action: { label: "Reprint", onClick: () => void printVoucherThermal(source, rawId, kind) },
    });
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

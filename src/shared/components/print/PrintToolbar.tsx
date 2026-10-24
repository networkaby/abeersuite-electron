"use client";

// Unified print toolbar — the SINGLE toolbar for every printable document
// (except barcode labels / QR cards, which keep their own real-size browser
// print). Implements the house print rule — there are exactly two print ways:
//
//   1. SILENT THERMAL: the page arrived by the thermal way (`bridge` prop set)
//      → the bridge is tried ONCE on mount. No printer configured in Printer
//      Settings, or the bridge fails → nothing prints; this page simply stays
//      open as the format-selection page (2).
//   2. FORMAT-SELECTION PAGE: the user picks the format (A4 / thermal 80mm —
//      each re-rendered through its own template via ?paper=/?width=) and the
//      PRINTER, in the browser print dialog. Never the bridge, never a silent
//      print — cross-format there is the user's own choice.
//
// The page decides the starting way: pass `bridge` for the thermal way; omit
// it for the selection page.

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { bridgeOk, bridgeRequest, thermalPrinterConfigured } from "@/shared/lib/bridge/hardwareBridge";

// Self-contained toolbar styling. This bar lives inside a STANDALONE print
// document (its own <html>, no app chrome / shadcn), so it carries its own
// inline styles rather than Tailwind utilities — inspired by the shipping-label
// toolbar's clean look, but deliberately its own (not shared) implementation.
const BAR: React.CSSProperties = {
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
    padding: "10px 14px", background: "#fff", borderBottom: "1px solid #ddd",
    position: "sticky", top: 0, zIndex: 10, marginBottom: 18,
    fontFamily: "Arial, 'Helvetica Neue', sans-serif",
};
const BTN: React.CSSProperties = {
    fontSize: 13, lineHeight: 1.2, padding: "7px 14px", border: "1px solid #ccc",
    borderRadius: 7, background: "#fff", color: "#111", cursor: "pointer",
};
const BTN_PRIMARY: React.CSSProperties = { ...BTN, background: "#111", color: "#fff", borderColor: "#111" };
const BTN_GHOST: React.CSSProperties = { ...BTN, border: "1px solid transparent", color: "#555" };
const SEG_WRAP: React.CSSProperties = { display: "inline-flex", border: "1px solid #ccc", borderRadius: 7, overflow: "hidden" };
const segBtn = (active: boolean, first: boolean): React.CSSProperties => ({
    fontSize: 13, lineHeight: 1.2, padding: "7px 14px", border: 0,
    borderLeft: first ? 0 : "1px solid #ddd",
    background: active ? "#111" : "#fff", color: active ? "#fff" : "#333", cursor: "pointer",
});
const STATUS = (color: string): React.CSSProperties => ({ fontSize: 12, color });

// Format picker options. `value` encodes "<paper>|<width>"; width is left blank
// (the 72mm variant was dropped — 80mm is the single thermal width).
const FORMAT_OPTIONS = [
    { value: "A4|",           label: "A4" },
    { value: "THERMAL_80MM|", label: "Thermal 80mm" },
] as const;

export type BridgeEndpoint = "/print/pos" | "/print/voucher";

export interface PrintToolbarBridge {
    /** Relay route for this document kind. If the bridge doesn't implement it
     *  the POST fails and we fall back to browser print. */
    endpoint: BridgeEndpoint;
    /** Ready-to-send relay payload (built server-side on the page). */
    payload:  unknown;
}

export interface PrintToolbarProps {
    /** When set, this document arrived by the THERMAL way: try the bridge once
     *  on mount; no printer / failure → stay as the selection page (no dialog).
     *  Omit for the format-selection page. */
    bridge?: PrintToolbarBridge;
    /** Selection page only: fire the print dialog on mount (default true). The
     *  "Print after save" / format-switch flows pass false so the user can
     *  pick a format first. Ignored in the thermal way. */
    autoPrint?: boolean;
    /** Render the A4 / thermal format dropdown once we're on the browser path. */
    showFormatPicker?: boolean;
    /** Server-resolved current paper ("A4" | "THERMAL_80MM"), for the selector. */
    currentPaper?: string;
    /** Server-resolved current width override ("" | "72"), for the selector. */
    currentWidth?: string;
}

type Status = "trying" | "thermal" | "browser";

export default function PrintToolbar({
    bridge,
    autoPrint = true,
    showFormatPicker = false,
    currentPaper,
    currentWidth = "",
}: PrintToolbarProps) {
    // Bridge mode starts by trying the relay; plain browser mode starts on the
    // browser path straight away (so the picker is available immediately).
    const [status, setStatus] = useState<Status>(bridge ? "trying" : "browser");   // the thermal way tries on mount
    const ranRef = useRef(false);

    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const sendToRelay = async (): Promise<boolean> => {
        if (!bridge) return false;
        try {
            if (!await bridgeOk("thermal", 1200)) return false;
            // Point 4 of the print rule: no printer selected in Printer Settings
            // (any type — LAN / COM / Windows) → no silent print at all.
            if (!await thermalPrinterConfigured()) return false;
            // `endpoint` keeps its leading slash: it is a public prop set by five receipt
            // pages, and the bridge command is the same string without it.
            await bridgeRequest("thermal", bridge.endpoint.slice(1), bridge.payload);
            return true;
        } catch {
            return false;
        }
    };

    // Thermal way: the bridge, once. It sends real ESC-POS text straight to the
    // printer (LAN :9100 / COM / Windows spooler), so it is sharp and can never
    // be mis-sized. Anything else (no printer configured, bridge down, send
    // failed) leaves this page as the format-selection page — no automatic
    // dialog, no Electron silent print (that went to whatever Windows default
    // printer was set, which is how an 80mm slip could land on an A4 sheet).
    const tryThermal = () =>
        sendToRelay().then((sent) => setStatus(sent ? "thermal" : "browser"));
    const runThermal = () => {
        setStatus("trying");
        void tryThermal();
    };

    useEffect(() => {
        if (ranRef.current) return;
        ranRef.current = true;
        if (bridge) {
            void tryThermal();   // status already starts at "trying"
        } else if (autoPrint) {
            window.print();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-print fires once on mount (ranRef)
    }, []);

    const currentValue = `${currentPaper ?? ""}|${currentWidth}`;

    const onFormatChange = (value: string) => {
        const [paper, width] = value.split("|");
        const params = new URLSearchParams(searchParams.toString());
        if (paper) params.set("paper", paper); else params.delete("paper");
        if (width) params.set("width", width); else params.delete("width");
        // Switching format shouldn't re-fire the dialog or re-try the bridge —
        // the user prints when ready via the Print button.
        params.set("autoprint", "0");
        params.delete("mode");
        router.replace(`${pathname}?${params.toString()}`);
    };

    // Picker only appears on the browser path — while the bridge is being tried
    // or after a successful thermal send it stays hidden (a clean one-tap flow).
    const pickerVisible = showFormatPicker && status === "browser";

    return (
        <div className="no-print" style={BAR}>
            {bridge && (
                <button
                    type="button"
                    onClick={runThermal}
                    disabled={status === "trying"}
                    style={{ ...BTN_PRIMARY, opacity: status === "trying" ? 0.6 : 1 }}
                >
                    🖨️ Print (thermal)
                </button>
            )}
            <button type="button" onClick={() => window.print()} style={bridge ? BTN : BTN_PRIMARY}>
                {bridge ? "Print in browser" : "🖨️ Print"}
            </button>

            {pickerVisible && (
                <div role="group" aria-label="Paper format" style={SEG_WRAP}>
                    {FORMAT_OPTIONS.map((o, i) => (
                        <button
                            key={o.value}
                            type="button"
                            onClick={() => onFormatChange(o.value)}
                            aria-pressed={o.value === currentValue}
                            style={segBtn(o.value === currentValue, i === 0)}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
            )}

            <button type="button" onClick={() => window.close()} style={BTN_GHOST}>
                ✕ Close
            </button>

            <span style={{ flex: 1 }} />
            {status === "trying"  && <span style={STATUS("#666")}>Sending to thermal printer…</span>}
            {status === "thermal" && <span style={STATUS("#16a34a")}>✓ Sent to thermal printer</span>}
            {bridge && status === "browser" && (
                <span style={STATUS("#d97706")}>No thermal printer — pick a format and print</span>
            )}
        </div>
    );
}

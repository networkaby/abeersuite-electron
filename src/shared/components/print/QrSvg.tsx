/**
 * QrSvg — pure synchronous QR renderer for print documents.
 *
 * Uses `qrcode`'s sync `QRCode.create()` (bit-matrix only — the async APIs are
 * just canvas/dataURL painters) and draws the modules as one `<path>` inside an
 * inline `<svg>`. No refs/effects, so it renders identically in:
 *   • server-rendered print routes (/receipt/*, /shipping-slip/*)
 *   • the client-side Print Templates live preview
 * and stays crisp at any print DPI (vector, like BarcodeSvg).
 *
 * If you need a QR anywhere else in the app, use this component — do NOT call
 * the `qrcode` lib's render APIs directly in a component.
 *
 * Invalid/empty values render nothing (print sheets must never crash on data).
 */

import QRCode from "qrcode";

type Props = {
    /** Text to encode (e.g. a upi://pay link). */
    value:      string;
    /** Rendered square size in px (default 96). */
    size?:      number;
    className?: string;
};

/** Encode → module matrix → single path of 1×1 squares in module space.
 *  Returns null on invalid input (never throws into the render). */
function buildQrPath(value: string): { d: string; n: number } | null {
    try {
        const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
        const n = qr.modules.size;
        const data = qr.modules.data;
        // 2-module quiet zone keeps scanners happy against surrounding print.
        let d = "";
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (data[y * n + x]) d += `M${x + 2} ${y + 2}h1v1h-1z`;
            }
        }
        return { d, n };
    } catch {
        return null;
    }
}

export function QrSvg({ value, size = 96, className = "" }: Props) {
    if (!value) return null;
    const qr = buildQrPath(value);
    if (!qr) return null;
    return (
        <svg
            viewBox={`0 0 ${qr.n + 4} ${qr.n + 4}`}
            width={size}
            height={size}
            className={className}
            shapeRendering="crispEdges"
            role="img"
            aria-label="QR code"
        >
            <rect width={qr.n + 4} height={qr.n + 4} fill="#fff" />
            <path d={qr.d} fill="#000" />
        </svg>
    );
}

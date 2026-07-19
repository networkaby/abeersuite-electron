/* eslint-disable @next/next/no-head-element -- standalone print document; next/head doesn't apply. */
"use client";

import { useEffect, useState } from "react";

// The Service Shipping Label — a packet address label, NOT a voucher, and NOT a
// one-card-fits-all: each paper size has its OWN bespoke layout (deliberately
// not DRY — an A4 envelope face and an A6 sticker are different designs).
//   A4 → landscape sheet, 1-up   (big envelope face, To in the lower-right)
//   A5 → portrait sheet, 2 rows  (half-sheet label, same skeleton, tighter)
//   A6 → landscape sheet, 2×2    (compact dense card)
// Qty tiles copies across sheets; unfilled cells stay blank (visible waste).
// Cut along the dashed cell borders. Thermal roll support is planned next.

export type LabelSize = "A4" | "A5" | "A6";

export interface ShippingLabelData {
    from:     { name: string; address: string | null; phone: string | null };
    to:       { name: string; address: string | null; phone: string | null };
    ticketNo: string;
    date:     string;
    ref:      string | null;
    device:   string;
    footer?:  string | null;
}

const SIZE_SPEC: Record<LabelSize, { cols: number; rows: number; orientation: "portrait" | "landscape" }> = {
    A4: { cols: 1, rows: 1, orientation: "landscape" },
    A5: { cols: 1, rows: 2, orientation: "portrait" },
    A6: { cols: 2, rows: 2, orientation: "landscape" },
};
const SHEET_MM = { landscape: { w: 297, h: 210 }, portrait: { w: 210, h: 297 } } as const;
const perPageOf = (s: LabelSize) => SIZE_SPEC[s].cols * SIZE_SPEC[s].rows;

function AddrLines({ text }: { text: string | null }) {
    if (!text) return null;
    return <>{text.split("\n").map((l, i) => <div key={i}>{l}</div>)}</>;
}

const CAP: React.CSSProperties = { textTransform: "uppercase", color: "#999" };

/** Shared bottom meta strip — the only piece all three sizes genuinely share. */
function MetaStrip({ data, fontPx, padX, padY }: { data: ShippingLabelData; fontPx: number; padX: number; padY: number }) {
    return (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", gap: "1.6em", flexWrap: "wrap", borderTop: "1px solid #ddd", padding: `${padY}px ${padX}px`, fontSize: fontPx, color: "#555" }}>
            <span><span style={{ color: "#999" }}>Ticket</span> <b style={{ color: "#111" }}>{data.ticketNo}</b></span>
            <span><span style={{ color: "#999" }}>Date</span> {data.date}</span>
            {data.ref && <span><span style={{ color: "#999" }}>Ref</span> <b style={{ color: "#111" }}>{data.ref}</b></span>}
            {data.device && <span><span style={{ color: "#999" }}>Device</span> {data.device}</span>}
            {data.footer && <span style={{ marginLeft: "auto", color: "#888" }}>{data.footer}</span>}
        </div>
    );
}

// ── A4 — full envelope face (landscape sheet) ────────────────────────────────
function A4Label({ data }: { data: ShippingLabelData }) {
    const { from, to } = data;
    return (
        <div style={{ position: "relative", width: "100%", height: "100%", color: "#111" }}>
            <div style={{ position: "absolute", top: 46, left: 53, maxWidth: "46%" }}>
                <div style={{ ...CAP, fontSize: 18, letterSpacing: 3 }}>From</div>
                <div style={{ fontSize: 28, fontWeight: 700, marginTop: 3 }}>{from.name}</div>
                <div style={{ fontSize: 23, color: "#444", lineHeight: 1.45, marginTop: 5 }}>
                    <AddrLines text={from.address} />
                    {from.phone && <div>Ph: {from.phone}</div>}
                </div>
            </div>
            <div style={{ position: "absolute", left: "38%", top: "44%", right: 53 }}>
                <div style={{ ...CAP, fontSize: 23, letterSpacing: 5 }}>Deliver to</div>
                <div style={{ fontSize: 71, fontWeight: 800, lineHeight: 1.05, marginTop: 7 }}>{to.name}</div>
                {to.address
                    ? <div style={{ fontSize: 34, color: "#222", lineHeight: 1.4, marginTop: 14 }}><AddrLines text={to.address} /></div>
                    : <div style={{ fontSize: 34, color: "#999", marginTop: 14 }}>Address not on file</div>}
                {to.phone && <div style={{ fontSize: 34, marginTop: 10 }}>Ph: {to.phone}</div>}
            </div>
            <MetaStrip data={data} fontPx={21} padX={53} padY={16} />
        </div>
    );
}

// ── A5 — half-sheet label (portrait sheet, 2 rows) ───────────────────────────
function A5Label({ data }: { data: ShippingLabelData }) {
    const { from, to } = data;
    return (
        <div style={{ position: "relative", width: "100%", height: "100%", color: "#111" }}>
            <div style={{ position: "absolute", top: 32, left: 40, maxWidth: "50%" }}>
                <div style={{ ...CAP, fontSize: 14, letterSpacing: 2.5 }}>From</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 3 }}>{from.name}</div>
                <div style={{ fontSize: 18, color: "#444", lineHeight: 1.4, marginTop: 4 }}>
                    <AddrLines text={from.address} />
                    {from.phone && <div>Ph: {from.phone}</div>}
                </div>
            </div>
            <div style={{ position: "absolute", left: "32%", top: "42%", right: 40 }}>
                <div style={{ ...CAP, fontSize: 16, letterSpacing: 3.5 }}>Deliver to</div>
                <div style={{ fontSize: 43, fontWeight: 800, lineHeight: 1.05, marginTop: 4 }}>{to.name}</div>
                {to.address
                    ? <div style={{ fontSize: 22, color: "#222", lineHeight: 1.4, marginTop: 9 }}><AddrLines text={to.address} /></div>
                    : <div style={{ fontSize: 22, color: "#999", marginTop: 9 }}>Address not on file</div>}
                {to.phone && <div style={{ fontSize: 22, marginTop: 6 }}>Ph: {to.phone}</div>}
            </div>
            <MetaStrip data={data} fontPx={15} padX={40} padY={11} />
        </div>
    );
}

// ── A6 — compact quarter card (landscape sheet, 2×2) ─────────────────────────
// Flex column (not absolute) so the meta strip can wrap without ever riding up
// into the address: From on top, To fills the middle, meta in flow at the bottom.
function A6Label({ data }: { data: ShippingLabelData }) {
    const { from, to } = data;
    return (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", color: "#111", padding: "18px 25px" }}>
            <div style={{ maxWidth: "72%" }}>
                <div style={{ ...CAP, fontSize: 11, letterSpacing: 1.8 }}>From</div>
                <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{from.name}</div>
                <div style={{ fontSize: 14, color: "#444", lineHeight: 1.3, marginTop: 2 }}>
                    <AddrLines text={from.address} />
                    {from.phone && <div>Ph: {from.phone}</div>}
                </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", marginLeft: "18%", padding: "6px 0" }}>
                <div style={{ ...CAP, fontSize: 13, letterSpacing: 2.6 }}>Deliver to</div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.05, marginTop: 2 }}>{to.name}</div>
                {to.address
                    ? <div style={{ fontSize: 17, color: "#222", lineHeight: 1.3, marginTop: 4 }}><AddrLines text={to.address} /></div>
                    : <div style={{ fontSize: 17, color: "#999", marginTop: 4 }}>Address not on file</div>}
                {to.phone && <div style={{ fontSize: 17, marginTop: 3 }}>Ph: {to.phone}</div>}
            </div>
            <div style={{ display: "flex", gap: "1.4em", flexWrap: "wrap", borderTop: "1px solid #ddd", paddingTop: 5, fontSize: 12, color: "#555" }}>
                <span><span style={{ color: "#999" }}>Ticket</span> <b style={{ color: "#111" }}>{data.ticketNo}</b></span>
                <span><span style={{ color: "#999" }}>Date</span> {data.date}</span>
                {data.ref && <span><span style={{ color: "#999" }}>Ref</span> <b style={{ color: "#111" }}>{data.ref}</b></span>}
                {data.device && <span><span style={{ color: "#999" }}>Device</span> {data.device}</span>}
                {data.footer && <span style={{ marginLeft: "auto", color: "#888" }}>{data.footer}</span>}
            </div>
        </div>
    );
}

const LAYOUT: Record<LabelSize, (p: { data: ShippingLabelData }) => React.ReactElement> = {
    A4: A4Label,
    A5: A5Label,
    A6: A6Label,
};

const PRINT_STYLES = `
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Arial, 'Helvetica Neue', sans-serif; background:#f3f4f6; }
    .toolbar { display:flex; align-items:center; gap:10px; padding:12px; background:#fff; border-bottom:1px solid #ddd; }
    .toolbar button { font-size:13px; padding:6px 12px; border:1px solid #ccc; border-radius:6px; background:#fff; cursor:pointer; }
    .toolbar button.primary { background:#111; color:#fff; border-color:#111; }
    .toolbar label { font-size:12px; color:#555; display:flex; align-items:center; gap:6px; }
    .toolbar input { width:56px; font-size:13px; padding:5px 8px; border:1px solid #ccc; border-radius:6px; }
    .toolbar .seg { display:flex; border:1px solid #ccc; border-radius:6px; overflow:hidden; }
    .toolbar .seg button { border:0; border-radius:0; }
    .toolbar .seg button.on { background:#111; color:#fff; }
    .toolbar .sp { flex:1; }
    .sheets { padding:20px 0; }
    .sheet { background:#fff; margin:0 auto 20px; box-shadow:0 1px 10px rgba(0,0,0,.2); }
    .grid { display:grid; width:100%; height:100%; }
    /* Dashed borders on every cell = the cut lines; blank cells show unused paper. */
    .cell { border:1px dashed #999; overflow:hidden; position:relative; }
    @media print {
        body { background:#fff; }
        .no-print { display:none !important; }
        .sheets { padding:0; }
        .sheet { box-shadow:none; margin:0; }
        .sheet + .sheet { page-break-before:always; }
    }
`;

export default function ShippingLabel({
    data, previewMode = false, autoPrint = true, initialSize = "A6",
}: {
    data: ShippingLabelData;
    previewMode?: boolean;
    autoPrint?: boolean;
    initialSize?: LabelSize;
}) {
    const [size, setSize] = useState<LabelSize>(initialSize);
    // Default run = ONE label (extra copies are opt-in via Qty).
    const [qty, setQty] = useState<number>(1);
    // The device name on a parcel advertises its contents — courier theft risk —
    // so it's hidden by default and shown only when explicitly ticked.
    const [showDevice, setShowDevice] = useState(false);
    const spec = SIZE_SPEC[size];
    const perPage = perPageOf(size);
    const Card = LAYOUT[size];

    useEffect(() => {
        if (previewMode || !autoPrint) return;
        const t = setTimeout(() => window.print(), 400);
        return () => clearTimeout(t);
    }, [previewMode, autoPrint]);

    if (previewMode) {
        // Settings preview — the compact A6 card, scaled to fit the panel.
        // (An A6 cell is 148.5×105mm ≈ 561×397px at 96dpi; scale ≈ 0.82.)
        return (
            <div style={{ width: 460, height: 326, overflow: "hidden", border: "1px dashed #999", borderRadius: 4, background: "#fff" }}>
                <div style={{ width: 561, height: 397, transform: "scale(0.82)", transformOrigin: "top left", fontFamily: "Arial, 'Helvetica Neue', sans-serif" }}>
                    <A6Label data={data} />
                </div>
            </div>
        );
    }

    const count = Math.max(1, Math.min(qty || 1, 200));
    const pages = Math.ceil(count / perPage);
    const dims = SHEET_MM[spec.orientation];

    return (
        <html lang="en">
            <head>
                <title>Shipping Label {data.ticketNo}</title>
                <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
            </head>
            <body>
                {/* @page must live in CSS; keyed per size so switching replaces the
                    tag (React can't reliably edit a hoisted <style> in the nested
                    head — sheet/grid geometry is inline below for the same reason). */}
                <style key={size} dangerouslySetInnerHTML={{ __html: `@page { size:A4 ${spec.orientation}; margin:0; }` }} />
                <div className="toolbar no-print">
                    <button type="button" className="primary" onClick={() => window.print()}>Print</button>
                    <div className="seg" role="group" aria-label="Label size">
                        <button type="button" className={size === "A4" ? "on" : ""} onClick={() => setSize("A4")}>A4 · 1-up</button>
                        <button type="button" className={size === "A5" ? "on" : ""} onClick={() => setSize("A5")}>A5 · 2-up</button>
                        <button type="button" className={size === "A6" ? "on" : ""} onClick={() => setSize("A6")}>A6 · 4-up</button>
                    </div>
                    <label>Qty
                        <input type="number" min={1} max={200} value={qty}
                            onChange={(e) => setQty(Math.max(1, Math.min(Number(e.target.value) || 1, 200)))} />
                    </label>
                    <label title="Hidden by default — naming the device on the packet invites courier theft">
                        <input type="checkbox" style={{ width: "auto" }} checked={showDevice}
                            onChange={(e) => setShowDevice(e.target.checked)} />
                        Show device
                    </label>
                    <span style={{ fontSize: 12, color: "#666" }}>
                        {count} label{count === 1 ? "" : "s"} · {perPage}/page · {pages} sheet{pages === 1 ? "" : "s"}
                    </span>
                    <span className="sp" />
                    <button type="button" onClick={() => window.close()}>Close</button>
                </div>
                <div className="sheets">
                    {Array.from({ length: pages }).map((_, p) => (
                        <div className="sheet" key={p} style={{ width: `${dims.w}mm`, height: `${dims.h}mm` }}>
                            <div className="grid" style={{ gridTemplateColumns: `repeat(${spec.cols},1fr)`, gridTemplateRows: `repeat(${spec.rows},1fr)` }}>
                                {Array.from({ length: perPage }).map((_, i) => (
                                    <div className="cell" key={i}>
                                        {p * perPage + i < count && <Card data={showDevice ? data : { ...data, device: "" }} />}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </body>
        </html>
    );
}

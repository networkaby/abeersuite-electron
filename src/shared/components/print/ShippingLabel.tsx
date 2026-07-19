/* eslint-disable @next/next/no-head-element -- standalone print document; next/head doesn't apply. */
"use client";

import { useEffect, useState } from "react";

// The Service Shipping Label — a packet address label, NOT a voucher, and NOT a
// one-card-fits-all: each paper size has its OWN bespoke layout (deliberately
// not DRY — an A4 envelope face and an A6 sticker are different designs).
//   A4 → landscape sheet, 1-up   (big envelope face, To in the lower-right)
//   A5 → portrait sheet, 2 rows  (half-sheet label, same skeleton, tighter)
//   A6 → landscape sheet, 2×2    (compact dense card)
//   THERMAL → 80mm roll strip    (quick local shipping from the counter printer)
//   TL100x50 → 100×50mm die-cut  (4×2" direct-thermal courier label roll)
// Qty tiles copies across sheets; unfilled cells stay blank (visible waste).
// Cut along the dashed cell borders. Roll formats stack one label per feed.

export type LabelSize = "A4" | "A5" | "A6" | "THERMAL" | "TL100x50";

export interface ShippingLabelData {
    from:     { name: string; address: string | null; phone: string | null };
    to:       { name: string; address: string | null; phone: string | null };
    ticketNo: string;
    date:     string;
    ref:      string | null;
    device:   string;
    footer?:  string | null;
}

// Which meta lines print — driven by the print template, per format variant:
//   Sheet = A4/A5/A6 · Thermal = 80mm roll · Tl = Thermal Label 100×50.
export type FieldVariant = "sheet" | "thermal" | "tl";
export interface LabelFieldFlags {
    showTicket: boolean;   showTicketThermal: boolean;   showTicketTl: boolean;
    showDate: boolean;     showDateThermal: boolean;     showDateTl: boolean;
    showRef: boolean;      showRefThermal: boolean;      showRefTl: boolean;
    showDevice: boolean;   showDeviceThermal: boolean;   showDeviceTl: boolean;   // OFF by default — theft risk
    showFooter: boolean;   showFooterThermal: boolean;   showFooterTl: boolean;
}
type Vis = { ticket: boolean; date: boolean; ref: boolean; device: boolean; footer: boolean };
const DEFAULT_FIELDS: LabelFieldFlags = {
    showTicket: true, showTicketThermal: true, showTicketTl: true,
    showDate: true, showDateThermal: true, showDateTl: true,
    showRef: true, showRefThermal: true, showRefTl: true,
    showDevice: false, showDeviceThermal: false, showDeviceTl: false,
    showFooter: true, showFooterThermal: true, showFooterTl: true,
};
function resolveVis(f: LabelFieldFlags, v: FieldVariant): Vis {
    if (v === "thermal") return { ticket: f.showTicketThermal, date: f.showDateThermal, ref: f.showRefThermal, device: f.showDeviceThermal, footer: f.showFooterThermal };
    if (v === "tl") return { ticket: f.showTicketTl, date: f.showDateTl, ref: f.showRefTl, device: f.showDeviceTl, footer: f.showFooterTl };
    return { ticket: f.showTicket, date: f.showDate, ref: f.showRef, device: f.showDevice, footer: f.showFooter };
}

type SheetSize = Exclude<LabelSize, "THERMAL" | "TL100x50">;
const SIZE_SPEC: Record<SheetSize, { cols: number; rows: number; orientation: "portrait" | "landscape" }> = {
    A4: { cols: 1, rows: 1, orientation: "landscape" },
    A5: { cols: 1, rows: 2, orientation: "portrait" },
    A6: { cols: 2, rows: 2, orientation: "landscape" },
};
const SHEET_MM = { landscape: { w: 297, h: 210 }, portrait: { w: 210, h: 297 } } as const;
// Roll formats print one label per feed (no sheet grid).
const isRoll = (s: LabelSize) => s === "THERMAL" || s === "TL100x50";
const perPageOf = (s: LabelSize) => (isRoll(s) ? 1 : SIZE_SPEC[s as SheetSize].cols * SIZE_SPEC[s as SheetSize].rows);

function AddrLines({ text }: { text: string | null }) {
    if (!text) return null;
    return <>{text.split("\n").map((l, i) => <div key={i}>{l}</div>)}</>;
}

const CAP: React.CSSProperties = { textTransform: "uppercase", color: "#999" };

/** Corner tag marking a return label (reverse: service centre → shop). */
function ReturnTag() {
    return <span className="rtag">Return</span>;
}

/** Shared bottom meta strip — the only piece all three sizes genuinely share.
 *  In normal flow (not absolute) so a long delivery address above it can never
 *  ride over it — the address block clips within its own area instead.
 *  Each line prints only if its template field flag (`vis`) is on. */
function MetaStrip({ data, vis, fontPx, padTop }: { data: ShippingLabelData; vis: Vis; fontPx: number; padTop: number }) {
    return (
        <div style={{ display: "flex", gap: "1.6em", flexWrap: "wrap", borderTop: "1px solid #ddd", paddingTop: padTop, fontSize: fontPx, color: "#555" }}>
            {vis.ticket && <span><span style={{ color: "#999" }}>Ticket</span> <b style={{ color: "#111" }}>{data.ticketNo}</b></span>}
            {vis.date && <span><span style={{ color: "#999" }}>Date</span> {data.date}</span>}
            {vis.ref && data.ref && <span><span style={{ color: "#999" }}>Ref</span> <b style={{ color: "#111" }}>{data.ref}</b></span>}
            {vis.device && data.device && <span><span style={{ color: "#999" }}>Device</span> {data.device}</span>}
            {vis.footer && data.footer && <span style={{ marginLeft: "auto", color: "#888" }}>{data.footer}</span>}
        </div>
    );
}

// ── A4 — full envelope face (landscape sheet) ────────────────────────────────
// Flex column so a long delivery address can't overrun the meta strip: From on
// top, Deliver-to fills the middle (clipped to its own band), meta in flow below.
function A4Label({ data, vis }: { data: ShippingLabelData; vis: Vis }) {
    const { from, to } = data;
    return (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", color: "#111", padding: "46px 53px" }}>
            <div style={{ maxWidth: "55%" }}>
                <div style={{ ...CAP, fontSize: 18, letterSpacing: 3 }}>From</div>
                <div style={{ fontSize: 28, fontWeight: 700, marginTop: 3 }}>{from.name}</div>
                <div style={{ fontSize: 23, color: "#444", lineHeight: 1.45, marginTop: 5 }}>
                    <AddrLines text={from.address} />
                    {from.phone && <div>Ph: {from.phone}</div>}
                </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center", marginLeft: "34%", padding: "16px 0" }}>
                <div style={{ ...CAP, fontSize: 23, letterSpacing: 5 }}>Deliver to</div>
                <div style={{ fontSize: 60, fontWeight: 800, lineHeight: 1.05, marginTop: 7 }}>{to.name}</div>
                {to.address
                    ? <div style={{ fontSize: 32, color: "#222", lineHeight: 1.4, marginTop: 12 }}><AddrLines text={to.address} /></div>
                    : <div style={{ fontSize: 32, color: "#999", marginTop: 12 }}>Address not on file</div>}
                {to.phone && <div style={{ fontSize: 32, marginTop: 9 }}>Ph: {to.phone}</div>}
            </div>
            <MetaStrip data={data} vis={vis} fontPx={21} padTop={14} />
        </div>
    );
}

// ── A5 — half-sheet label (portrait sheet, 2 rows) ───────────────────────────
// Same flex skeleton as A4/A6 so long addresses stay contained (this is the size
// most prone to overflow — least room, big deliver-to type).
function A5Label({ data, vis }: { data: ShippingLabelData; vis: Vis }) {
    const { from, to } = data;
    return (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", color: "#111", padding: "30px 40px" }}>
            <div style={{ maxWidth: "62%" }}>
                <div style={{ ...CAP, fontSize: 14, letterSpacing: 2.5 }}>From</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 3 }}>{from.name}</div>
                <div style={{ fontSize: 18, color: "#444", lineHeight: 1.4, marginTop: 4 }}>
                    <AddrLines text={from.address} />
                    {from.phone && <div>Ph: {from.phone}</div>}
                </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center", marginLeft: "20%", padding: "10px 0" }}>
                <div style={{ ...CAP, fontSize: 16, letterSpacing: 3.5 }}>Deliver to</div>
                <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.08, marginTop: 4 }}>{to.name}</div>
                {to.address
                    ? <div style={{ fontSize: 20, color: "#222", lineHeight: 1.4, marginTop: 8 }}><AddrLines text={to.address} /></div>
                    : <div style={{ fontSize: 20, color: "#999", marginTop: 8 }}>Address not on file</div>}
                {to.phone && <div style={{ fontSize: 20, marginTop: 5 }}>Ph: {to.phone}</div>}
            </div>
            <MetaStrip data={data} vis={vis} fontPx={15} padTop={10} />
        </div>
    );
}

// ── A6 — compact quarter card (landscape sheet, 2×2) ─────────────────────────
// Flex column (not absolute) so the meta strip can wrap without ever riding up
// into the address: From on top, To fills the middle, meta in flow at the bottom.
function A6Label({ data, vis }: { data: ShippingLabelData; vis: Vis }) {
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
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center", marginLeft: "18%", padding: "6px 0" }}>
                <div style={{ ...CAP, fontSize: 13, letterSpacing: 2.6 }}>Deliver to</div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.05, marginTop: 2 }}>{to.name}</div>
                {to.address
                    ? <div style={{ fontSize: 17, color: "#222", lineHeight: 1.3, marginTop: 4 }}><AddrLines text={to.address} /></div>
                    : <div style={{ fontSize: 17, color: "#999", marginTop: 4 }}>Address not on file</div>}
                {to.phone && <div style={{ fontSize: 17, marginTop: 3 }}>Ph: {to.phone}</div>}
            </div>
            <div style={{ display: "flex", gap: "1.4em", flexWrap: "wrap", borderTop: "1px solid #ddd", paddingTop: 5, fontSize: 12, color: "#555" }}>
                {vis.ticket && <span><span style={{ color: "#999" }}>Ticket</span> <b style={{ color: "#111" }}>{data.ticketNo}</b></span>}
                {vis.date && <span><span style={{ color: "#999" }}>Date</span> {data.date}</span>}
                {vis.ref && data.ref && <span><span style={{ color: "#999" }}>Ref</span> <b style={{ color: "#111" }}>{data.ref}</b></span>}
                {vis.device && data.device && <span><span style={{ color: "#999" }}>Device</span> {data.device}</span>}
                {vis.footer && data.footer && <span style={{ marginLeft: "auto", color: "#888" }}>{data.footer}</span>}
            </div>
        </div>
    );
}

// ── THERMAL — 80mm roll strip (quick local shipping) ─────────────────────────
// Everything stacks down the narrow roll: From small, To dominant, meta lines.
function ThermalLabel({ data, vis }: { data: ShippingLabelData; vis: Vis }) {
    const { from, to } = data;
    return (
        <div style={{ color: "#111", padding: "10px 8px" }}>
            <div style={{ ...CAP, fontSize: 10, letterSpacing: 1.5 }}>From</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{from.name}</div>
            <div style={{ fontSize: 12, color: "#444", lineHeight: 1.3 }}>
                <AddrLines text={from.address} />
                {from.phone && <div>Ph: {from.phone}</div>}
            </div>
            <div style={{ borderTop: "1px solid #ddd", margin: "8px 0" }} />
            <div style={{ ...CAP, fontSize: 11, letterSpacing: 2 }}>Deliver to</div>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1, marginTop: 2 }}>{to.name}</div>
            {to.address
                ? <div style={{ fontSize: 14, color: "#222", lineHeight: 1.35, marginTop: 4 }}><AddrLines text={to.address} /></div>
                : <div style={{ fontSize: 14, color: "#999", marginTop: 4 }}>Address not on file</div>}
            {to.phone && <div style={{ fontSize: 14, marginTop: 3 }}>Ph: {to.phone}</div>}
            <div style={{ borderTop: "1px solid #ddd", margin: "8px 0" }} />
            <div style={{ fontSize: 11, color: "#555", lineHeight: 1.5 }}>
                {(vis.ticket || vis.date) && <div>{vis.ticket && <>Ticket <b style={{ color: "#111" }}>{data.ticketNo}</b></>}{vis.ticket && vis.date && " · "}{vis.date && data.date}</div>}
                {vis.ref && data.ref && <div>Ref <b style={{ color: "#111" }}>{data.ref}</b></div>}
                {vis.device && data.device && <div>Device {data.device}</div>}
                {vis.footer && data.footer && <div style={{ color: "#888" }}>{data.footer}</div>}
            </div>
        </div>
    );
}

// ── TL100x50 — 100×50mm die-cut courier label (4×2" direct thermal) ──────────
// Short, wide (2:1). From tiny up top, To dominant, one meta line at the foot.
function Label100x50({ data, vis }: { data: ShippingLabelData; vis: Vis }) {
    const { from, to } = data;
    return (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", color: "#111", padding: "3mm 4mm", overflow: "hidden" }}>
            {/* From — full sender line; address flattened to commas to fit the 50mm height. */}
            <div style={{ fontSize: 8.5, color: "#555", lineHeight: 1.3 }}>
                <span style={{ ...CAP, letterSpacing: 1 }}>From </span>
                <b style={{ color: "#111" }}>{from.name}</b>
                {from.address && <span> · {from.address.replace(/\s*\n\s*/g, ", ")}</span>}
                {from.phone && <span> · Ph: {from.phone}</span>}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", paddingTop: "1mm" }}>
                <div style={{ ...CAP, fontSize: 9, letterSpacing: 1.5 }}>Deliver to</div>
                <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.05, marginTop: 1 }}>{to.name}</div>
                {to.address
                    ? <div style={{ fontSize: 11, color: "#222", lineHeight: 1.25, marginTop: 2 }}><AddrLines text={to.address} /></div>
                    : <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>Address not on file</div>}
                {to.phone && <div style={{ fontSize: 11, marginTop: 1 }}>Ph: {to.phone}</div>}
            </div>
            <div style={{ borderTop: "1px solid #ddd", paddingTop: "1mm", display: "flex", gap: 12, flexWrap: "wrap", fontSize: 8.5, color: "#555" }}>
                {vis.ticket && <span>Ticket <b style={{ color: "#111" }}>{data.ticketNo}</b></span>}
                {vis.date && <span>{data.date}</span>}
                {vis.ref && data.ref && <span>Ref <b style={{ color: "#111" }}>{data.ref}</b></span>}
                {vis.device && data.device && <span>{data.device}</span>}
                {vis.footer && data.footer && <span style={{ marginLeft: "auto", color: "#888" }}>{data.footer}</span>}
            </div>
        </div>
    );
}

const LAYOUT: Record<SheetSize, (p: { data: ShippingLabelData; vis: Vis }) => React.ReactElement> = {
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
    .toolbar input[type=checkbox] { width:auto; padding:0; }
    /* Return-label marker — a small corner tag so operators can tell the reverse
       (service centre → shop) label apart from the outbound one at a glance. */
    .rtag { position:absolute; top:6px; right:6px; z-index:2; font-size:9px; line-height:1;
        letter-spacing:1px; text-transform:uppercase; font-weight:700; color:#b45309;
        border:1px solid #f59e0b; background:#fffbeb; border-radius:4px; padding:2px 5px; }
    .toolbar .seg { display:flex; border:1px solid #ccc; border-radius:6px; overflow:hidden; }
    .toolbar .seg button { border:0; border-radius:0; }
    .toolbar .seg button.on { background:#111; color:#fff; }
    .toolbar .sp { flex:1; }
    .sheets { padding:20px 0; }
    .sheet { background:#fff; margin:0 auto 20px; box-shadow:0 1px 10px rgba(0,0,0,.2); }
    .grid { display:grid; width:100%; height:100%; }
    /* Dashed borders on every cell = the cut lines; blank cells show unused paper. */
    .cell { border:1px dashed #999; overflow:hidden; position:relative; }
    /* 80mm roll — strips stack down the roll, a dashed cut line between copies. */
    .roll { width:76mm; margin:20px auto; background:#fff; box-shadow:0 1px 10px rgba(0,0,0,.2); }
    .strip { break-inside:avoid; }
    .strip + .strip { border-top:1px dashed #999; }
    /* 100×50mm die-cut labels — one per feed, page break between copies. */
    .dtwrap { padding:20px 0; }
    .dtlabel { width:100mm; height:50mm; margin:0 auto 12px; background:#fff; box-shadow:0 1px 10px rgba(0,0,0,.2); overflow:hidden; }
    @media print {
        body { background:#fff; }
        .no-print { display:none !important; }
        .sheets { padding:0; }
        .sheet { box-shadow:none; margin:0; }
        .sheet + .sheet { page-break-before:always; }
        .roll { margin:0; box-shadow:none; }
        .dtwrap { padding:0; }
        .dtlabel { margin:0; box-shadow:none; page-break-after:always; }
    }
`;

export default function ShippingLabel({
    data, previewMode = false, previewFormat = "sheet", autoPrint = true, initialSize = "A6", fields = DEFAULT_FIELDS,
}: {
    data: ShippingLabelData;
    previewMode?: boolean;
    /** Which layout the settings preview shows: A6 card, 80mm strip, or TL 100×50. */
    previewFormat?: FieldVariant;
    autoPrint?: boolean;
    initialSize?: LabelSize;
    /** Which meta lines print, per format — from the print template. */
    fields?: LabelFieldFlags;
}) {
    const [size, setSize] = useState<LabelSize>(initialSize);
    // Default run = ONE label (extra copies are opt-in via Qty).
    const [qty, setQty] = useState<number>(1);
    // Optional at print time: also print the reverse label (service centre → shop)
    // so the centre can paste it on the device's return packet.
    const [withReturn, setWithReturn] = useState<boolean>(false);
    const isThermal = size === "THERMAL";
    const isTl = size === "TL100x50";
    const roll = isRoll(size);
    const spec = SIZE_SPEC[roll ? "A6" : (size as SheetSize)]; // unused for roll formats
    const perPage = perPageOf(size);

    useEffect(() => {
        if (previewMode || !autoPrint) return;
        const t = setTimeout(() => window.print(), 400);
        return () => clearTimeout(t);
    }, [previewMode, autoPrint]);

    if (previewMode) {
        // Settings preview — each format renders its OWN layout (no DRY):
        //   thermal → 80mm strip · tl → TL 100×50 die-cut · sheet → A6 card (scaled).
        const font = "Arial, 'Helvetica Neue', sans-serif";
        if (previewFormat === "thermal") {
            return (
                <div style={{ width: 300, border: "1px dashed #999", borderRadius: 4, background: "#fff", fontFamily: font }}>
                    <ThermalLabel data={data} vis={resolveVis(fields, "thermal")} />
                </div>
            );
        }
        if (previewFormat === "tl") {
            // 100×50mm at ~3.78px/mm ≈ 378×189px.
            return (
                <div style={{ width: 378, height: 189, overflow: "hidden", border: "1px dashed #999", borderRadius: 4, background: "#fff", fontFamily: font }}>
                    <Label100x50 data={data} vis={resolveVis(fields, "tl")} />
                </div>
            );
        }
        return (
            <div style={{ width: 460, height: 326, overflow: "hidden", border: "1px dashed #999", borderRadius: 4, background: "#fff" }}>
                <div style={{ width: 561, height: 397, transform: "scale(0.82)", transformOrigin: "top left", fontFamily: font }}>
                    <A6Label data={data} vis={resolveVis(fields, "sheet")} />
                </div>
            </div>
        );
    }

    const count = Math.max(1, Math.min(qty || 1, 200));
    const dims = SHEET_MM[spec.orientation];
    // Each format reads its own field variant: 80mm roll → thermal, TL 100×50 → tl,
    // A4/A5/A6 → sheet.
    const vis = resolveVis(fields, isThermal ? "thermal" : isTl ? "tl" : "sheet");
    const Card = LAYOUT[roll ? "A6" : (size as SheetSize)];

    // Build the label faces. Each copy is one outbound label (shop → centre); if
    // the return option is on, a reverse label (centre → shop) follows it so both
    // print in one run — the outbound to send, the return for the centre to reuse.
    const returnData: ShippingLabelData = { ...data, from: data.to, to: data.from };
    const faces: { data: ShippingLabelData; kind: "outbound" | "return" }[] = [];
    for (let i = 0; i < count; i++) {
        faces.push({ data, kind: "outbound" });
        if (withReturn) faces.push({ data: returnData, kind: "return" });
    }
    const total = faces.length;
    const pages = Math.ceil(total / perPage);
    const runNote = withReturn ? ` (${count} send + ${count} return)` : "";

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
                <style key={size} dangerouslySetInnerHTML={{ __html:
                    isThermal
                        ? `@page { size:80mm auto; margin:2mm; }`
                        : isTl
                            ? `@page { size:100mm 50mm; margin:0; }`
                            : `@page { size:A4 ${spec.orientation}; margin:0; }` }} />
                <div className="toolbar no-print">
                    <button type="button" className="primary" onClick={() => window.print()}>Print</button>
                    <div className="seg" role="group" aria-label="Label size">
                        <button type="button" className={size === "A4" ? "on" : ""} onClick={() => setSize("A4")}>A4 · 1-up</button>
                        <button type="button" className={size === "A5" ? "on" : ""} onClick={() => setSize("A5")}>A5 · 2-up</button>
                        <button type="button" className={size === "A6" ? "on" : ""} onClick={() => setSize("A6")}>A6 · 4-up</button>
                        <button type="button" className={isThermal ? "on" : ""} onClick={() => setSize("THERMAL")} title="80mm roll — quick local shipping from the counter printer">Thermal · roll</button>
                        <button type="button" className={isTl ? "on" : ""} onClick={() => setSize("TL100x50")} title="100×50mm die-cut direct-thermal courier label roll">TL 100×50</button>
                    </div>
                    <label>Qty
                        <input type="number" min={1} max={200} value={qty}
                            onChange={(e) => setQty(Math.max(1, Math.min(Number(e.target.value) || 1, 200)))} />
                    </label>
                    <label title="Also print the reverse label (service centre → shop) so the centre can paste it on the device's return packet">
                        <input type="checkbox" checked={withReturn} onChange={(e) => setWithReturn(e.target.checked)} />
                        Return label
                    </label>
                    <span style={{ fontSize: 12, color: "#666" }}>
                        {isThermal
                            ? `${total} strip${total === 1 ? "" : "s"}${runNote} · 80mm roll`
                            : isTl
                                ? `${total} label${total === 1 ? "" : "s"}${runNote} · 100×50mm roll`
                                : `${total} label${total === 1 ? "" : "s"}${runNote} · ${perPage}/page · ${pages} sheet${pages === 1 ? "" : "s"}`}
                    </span>
                    <span className="sp" />
                    <button type="button" onClick={() => window.close()}>Close</button>
                </div>
                {isThermal ? (
                    /* 80mm roll — copies stack down the roll with cut lines between. */
                    <div className="roll">
                        {faces.map((f, i) => (
                            <div className="strip" key={i} style={{ position: "relative" }}>
                                {f.kind === "return" && <ReturnTag />}
                                <ThermalLabel data={f.data} vis={vis} />
                            </div>
                        ))}
                    </div>
                ) : isTl ? (
                    /* 100×50mm die-cut — one label per feed, page break between. */
                    <div className="dtwrap">
                        {faces.map((f, i) => (
                            <div className="dtlabel" key={i} style={{ position: "relative" }}>
                                {f.kind === "return" && <ReturnTag />}
                                <Label100x50 data={f.data} vis={vis} />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="sheets">
                        {Array.from({ length: pages }).map((_, p) => (
                            <div className="sheet" key={p} style={{ width: `${dims.w}mm`, height: `${dims.h}mm` }}>
                                <div className="grid" style={{ gridTemplateColumns: `repeat(${spec.cols},1fr)`, gridTemplateRows: `repeat(${spec.rows},1fr)` }}>
                                    {Array.from({ length: perPage }).map((_, i) => {
                                        const f = faces[p * perPage + i];
                                        return (
                                            <div className="cell" key={i}>
                                                {f && <>{f.kind === "return" && <ReturnTag />}<Card data={f.data} vis={vis} /></>}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </body>
        </html>
    );
}

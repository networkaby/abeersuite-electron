/* eslint-disable @next/next/no-head-element -- standalone print document; next/head doesn't apply. */
"use client";

import { useEffect, useState } from "react";
import { BarcodeSvg } from "@/modules/inventory/components/BarcodeSvg";

// The Parcel Shipping Label — for shop orders shipped by OUR couriers (local
// delivery / Standard courier). Courier-standard face, modelled on what the
// aggregators print: payment banner (COD amount / PREPAID), Deliver-to with the
// pincode huge, AWB/order barcode, From small, meta strip. Aggregator shipments
// (Shiprocket / Shipway) print the carrier's own PDF — never this document.
//
// Sizes (each its own bespoke layout — deliberately not DRY):
//   TL100x150 → 100×150mm (4×6") die-cut roll — THE courier standard, 1/feed
//   A4        → landscape sheet, 2-up 4×6 faces with cut lines (office printer)
//   THERMAL   → 80mm roll strip (counter printer, quick local runs)

export type ParcelLabelSize = "TL100x150" | "A4" | "THERMAL";

export interface ParcelLabelData {
    from: { name: string; address: string | null; phone: string | null };
    to: { name: string; address: string | null; phone: string | null; pincode: string | null };
    orderNo: string; // "WEB-27"
    date: string;
    courier: string; // service shown to the customer ("Local delivery · Bike")
    awb: string | null; // manual tracking id if staff entered one
    payment: { cod: boolean; amountLabel: string | null }; // COD collect amount
    weightGrams: number;
    items: number;
    footer?: string | null;
}

function AddrLines({ text }: { text: string | null }) {
    if (!text) return null;
    return <>{text.split("\n").map((l, i) => <div key={i}>{l}</div>)}</>;
}

const CAP: React.CSSProperties = { textTransform: "uppercase", color: "#999" };

const kg = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`);

// ── The 4×6 face (used by the TL roll AND as each A4 cell — an A4 cell IS a
//    4×6 label to be cut out, so the geometry is genuinely the same document). ─
function Face4x6({ data }: { data: ParcelLabelData }) {
    const { from, to } = data;
    const code = data.awb || data.orderNo;
    return (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", color: "#111", padding: "4mm 5mm", overflow: "hidden" }}>
            {/* Courier + payment banner */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.courier}</div>
                {data.payment.cod ? (
                    <div style={{ background: "#111", color: "#fff", fontWeight: 800, fontSize: 14, padding: "3px 10px", borderRadius: 3, whiteSpace: "nowrap" }}>
                        COD {data.payment.amountLabel}
                    </div>
                ) : (
                    <div style={{ border: "2px solid #111", fontWeight: 800, fontSize: 12, padding: "2px 10px", borderRadius: 3, letterSpacing: 1 }}>
                        PREPAID
                    </div>
                )}
            </div>
            <div style={{ borderTop: "2px solid #111", margin: "2.5mm 0 2mm" }} />

            {/* Deliver to — name big, address, pincode HUGE */}
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                <div style={{ ...CAP, fontSize: 10, letterSpacing: 2 }}>Deliver to</div>
                <div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.08, marginTop: 1 }}>{to.name}</div>
                {to.address && (
                    <div style={{ fontSize: 13, color: "#222", lineHeight: 1.3, marginTop: 2 }}>
                        <AddrLines text={to.address} />
                    </div>
                )}
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 2 }}>
                    {to.pincode && <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 3 }}>{to.pincode}</div>}
                    {to.phone && <div style={{ fontSize: 13 }}>Ph: {to.phone}</div>}
                </div>
            </div>

            {/* Barcode of the AWB (or the order no when no AWB) */}
            <div style={{ textAlign: "center", margin: "1.5mm 0" }}>
                <BarcodeSvg value={code} height={38} fontSize={12} margin={2} />
            </div>

            <div style={{ borderTop: "1px solid #999", paddingTop: "1.5mm" }}>
                {/* From — small return block */}
                <div style={{ fontSize: 9.5, color: "#555", lineHeight: 1.35 }}>
                    <span style={{ ...CAP, letterSpacing: 1 }}>If undelivered, return to </span>
                    <b style={{ color: "#111" }}>{from.name}</b>
                    {from.address && <span> · {from.address.replace(/\s*\n\s*/g, ", ")}</span>}
                    {from.phone && <span> · Ph: {from.phone}</span>}
                </div>
                {/* Meta strip */}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 10, color: "#555", marginTop: "1.2mm" }}>
                    <span>Order <b style={{ color: "#111" }}>{data.orderNo}</b></span>
                    <span>{data.date}</span>
                    <span>Wt {kg(data.weightGrams)}</span>
                    <span>{data.items} item{data.items === 1 ? "" : "s"}</span>
                    {data.footer && <span style={{ marginLeft: "auto", color: "#888" }}>{data.footer}</span>}
                </div>
            </div>
        </div>
    );
}

// ── 80mm roll strip — everything stacks down the narrow roll ─────────────────
function ThermalStrip({ data }: { data: ParcelLabelData }) {
    const { from, to } = data;
    const code = data.awb || data.orderNo;
    return (
        <div style={{ color: "#111", padding: "10px 8px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{data.courier}</div>
                {data.payment.cod ? (
                    <div style={{ background: "#111", color: "#fff", fontWeight: 800, fontSize: 12, padding: "2px 8px", borderRadius: 3 }}>
                        COD {data.payment.amountLabel}
                    </div>
                ) : (
                    <div style={{ border: "2px solid #111", fontWeight: 800, fontSize: 10, padding: "1px 8px", borderRadius: 3, letterSpacing: 1 }}>PREPAID</div>
                )}
            </div>
            <div style={{ borderTop: "2px solid #111", margin: "6px 0" }} />
            <div style={{ ...CAP, fontSize: 10, letterSpacing: 2 }}>Deliver to</div>
            <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1, marginTop: 2 }}>{to.name}</div>
            {to.address && <div style={{ fontSize: 13, color: "#222", lineHeight: 1.3, marginTop: 3 }}><AddrLines text={to.address} /></div>}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
                {to.pincode && <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 2 }}>{to.pincode}</div>}
                {to.phone && <div style={{ fontSize: 12 }}>Ph: {to.phone}</div>}
            </div>
            <div style={{ textAlign: "center", margin: "6px 0" }}>
                <BarcodeSvg value={code} height={34} fontSize={10} margin={2} />
            </div>
            <div style={{ borderTop: "1px solid #999", paddingTop: 4, fontSize: 10, color: "#555", lineHeight: 1.5 }}>
                <div>
                    <span style={{ ...CAP, letterSpacing: 1 }}>Return: </span>
                    <b style={{ color: "#111" }}>{from.name}</b>
                    {from.phone && <> · Ph: {from.phone}</>}
                </div>
                {from.address && <div>{from.address.replace(/\s*\n\s*/g, ", ")}</div>}
                <div style={{ marginTop: 2 }}>
                    Order <b style={{ color: "#111" }}>{data.orderNo}</b> · {data.date} · Wt {kg(data.weightGrams)} · {data.items} item{data.items === 1 ? "" : "s"}
                </div>
                {data.footer && <div style={{ color: "#888" }}>{data.footer}</div>}
            </div>
        </div>
    );
}

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
    /* 100×150mm die-cut — one per feed, page break between copies. */
    .dtwrap { padding:20px 0; }
    .dt4x6 { width:100mm; height:150mm; margin:0 auto 12px; background:#fff; box-shadow:0 1px 10px rgba(0,0,0,.2); overflow:hidden; }
    /* A4 landscape — two 4×6 faces side by side, dashed cut borders. */
    .sheets { padding:20px 0; }
    .sheet { width:297mm; height:210mm; background:#fff; margin:0 auto 20px; box-shadow:0 1px 10px rgba(0,0,0,.2);
        display:flex; align-items:center; justify-content:center; gap:10mm; }
    .cell { width:100mm; height:150mm; border:1px dashed #999; overflow:hidden; }
    /* 80mm roll — strips stack with cut lines between. */
    .roll { width:76mm; margin:20px auto; background:#fff; box-shadow:0 1px 10px rgba(0,0,0,.2); }
    .strip { break-inside:avoid; }
    .strip + .strip { border-top:1px dashed #999; }
    @media print {
        body { background:#fff; }
        .no-print { display:none !important; }
        .dtwrap { padding:0; }
        .dt4x6 { margin:0; box-shadow:none; page-break-after:always; }
        .sheets { padding:0; }
        .sheet { box-shadow:none; margin:0; }
        .sheet + .sheet { page-break-before:always; }
        .roll { margin:0; box-shadow:none; }
    }
`;

export default function OrderParcelLabel({
    data, previewMode = false, autoPrint = true, initialSize = "TL100x150",
}: {
    data: ParcelLabelData;
    previewMode?: boolean;
    autoPrint?: boolean;
    initialSize?: ParcelLabelSize;
}) {
    const [size, setSize] = useState<ParcelLabelSize>(initialSize);
    const [qty, setQty] = useState<number>(1);

    useEffect(() => {
        if (previewMode || !autoPrint) return;
        const t = setTimeout(() => window.print(), 400);
        return () => clearTimeout(t);
    }, [previewMode, autoPrint]);

    if (previewMode) {
        // Settings preview — the 4×6 face at ~3.4px/mm (340×510 → scaled to fit).
        return (
            <div style={{ width: 300, height: 450, overflow: "hidden", border: "1px dashed #999", borderRadius: 4, background: "#fff" }}>
                <div style={{ width: 378, height: 567, transform: "scale(0.794)", transformOrigin: "top left", fontFamily: "Arial, 'Helvetica Neue', sans-serif" }}>
                    <Face4x6 data={data} />
                </div>
            </div>
        );
    }

    const count = Math.max(1, Math.min(qty || 1, 100));
    const faces = Array.from({ length: count });
    const pages = Math.ceil(count / 2); // A4: 2-up

    return (
        <html lang="en">
            <head>
                <title>Parcel Label {data.orderNo}</title>
                <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
            </head>
            <body>
                <style key={size} dangerouslySetInnerHTML={{ __html:
                    size === "THERMAL"
                        ? `@page { size:80mm auto; margin:2mm; }`
                        : size === "TL100x150"
                            ? `@page { size:100mm 150mm; margin:0; }`
                            : `@page { size:A4 landscape; margin:0; }` }} />
                <div className="toolbar no-print">
                    <button type="button" className="primary" onClick={() => window.print()}>Print</button>
                    <div className="seg" role="group" aria-label="Label size">
                        <button type="button" className={size === "TL100x150" ? "on" : ""} onClick={() => setSize("TL100x150")} title="100×150mm (4×6&quot;) die-cut courier label roll — the standard">TL 100×150</button>
                        <button type="button" className={size === "A4" ? "on" : ""} onClick={() => setSize("A4")} title="A4 landscape sheet, two 4×6 labels with cut lines">A4 · 2-up</button>
                        <button type="button" className={size === "THERMAL" ? "on" : ""} onClick={() => setSize("THERMAL")} title="80mm roll — quick local runs from the counter printer">Thermal · roll</button>
                    </div>
                    <label>Qty
                        <input type="number" min={1} max={100} value={qty}
                            onChange={(e) => setQty(Math.max(1, Math.min(Number(e.target.value) || 1, 100)))} />
                    </label>
                    <span style={{ fontSize: 12, color: "#666" }}>
                        {size === "THERMAL"
                            ? `${count} strip${count === 1 ? "" : "s"} · 80mm roll`
                            : size === "TL100x150"
                                ? `${count} label${count === 1 ? "" : "s"} · 100×150mm roll`
                                : `${count} label${count === 1 ? "" : "s"} · 2/page · ${pages} sheet${pages === 1 ? "" : "s"}`}
                    </span>
                    <span className="sp" />
                    <button type="button" onClick={() => window.close()}>Close</button>
                </div>
                {size === "THERMAL" ? (
                    <div className="roll">
                        {faces.map((_, i) => (
                            <div className="strip" key={i}><ThermalStrip data={data} /></div>
                        ))}
                    </div>
                ) : size === "TL100x150" ? (
                    <div className="dtwrap">
                        {faces.map((_, i) => (
                            <div className="dt4x6" key={i}><Face4x6 data={data} /></div>
                        ))}
                    </div>
                ) : (
                    <div className="sheets">
                        {Array.from({ length: pages }).map((_, p) => (
                            <div className="sheet" key={p}>
                                {Array.from({ length: 2 }).map((_, i) =>
                                    p * 2 + i < count ? (
                                        <div className="cell" key={i}><Face4x6 data={data} /></div>
                                    ) : (
                                        <div className="cell" key={i} style={{ borderColor: "transparent" }} />
                                    ),
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </body>
        </html>
    );
}

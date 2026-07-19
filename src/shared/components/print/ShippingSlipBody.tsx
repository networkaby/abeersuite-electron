/**
 * Shipping-slip / delivery-challan body — the to/owner boxes, device table and
 * sign-off rows that sit between the shared header and footer chrome of a
 * SHIPPING_SLIP print. Pure presentational, so it renders identically in:
 *   • /shipping-slip/[ticketId] — the real printout
 *   • the Print Templates settings preview (fed sample data)
 *
 * A shipping slip is its own document (not an invoice), so it carries its own
 * body rather than the generic line-items layout.
 */

export interface ShippingSlipBodyData {
    ticketNo:    string;
    date:        string;
    ref:         string | null;
    /** Resolved service-centre party (live name/address/phone), or null. */
    party:       { name: string; address: string | null; phone: string | null } | null;
    /** Fallback service-centre name when `party` did not resolve. */
    partyNameFallback: string | null;
    owner:       { name: string; phone: string | null };
    /** Box label — "Device Owner" (real details) or "Contact (on behalf of
     *  owner)" when the shop fronts the contact. Defaults to "Device Owner". */
    ownerLabel?: string;
    device:      { type: string; brand: string; model: string; problem: string };
    accessories: string | null;
    condition:   string | null;
    /** False → no slip snapshot saved yet (shows a hint). */
    hasSlip:     boolean;
    preparedBy:  string | null;
    // Sign-off rows + the service-centre block — toggled per print template.
    // Default true (undefined = shown).
    showSentBy?:     boolean;   // shop signature (same line as Received by)
    showReceivedBy?: boolean;   // service-centre signature (same line as Sent by)
    showPreparedBy?: boolean;
    // One toggle for the "for Service Centre use" part: findings write-area +
    // the "return this slip with the device" note.
    showFindings?:   boolean;
    /** Shop signature line — driven by the template's customisable
     *  `signatureLabel` field (defaults to "Sent by (Shop)"). */
    sentByLabel?:    string;
}

// Sign-off column — fixed width so a hidden neighbour doesn't recentre the other.
const SIGN_COL: React.CSSProperties = {
    width: "45%", flexShrink: 0, borderTop: "1px solid #000",
    paddingTop: 3, fontSize: 10, color: "#555", textAlign: "center",
};
// Thermal roll: the two signatures stack full-width rather than sitting side by
// side (45% columns are too cramped at 80mm).
const SIGN_COL_THERMAL: React.CSSProperties = {
    width: "100%", borderTop: "1px solid #000",
    paddingTop: 3, fontSize: 10, color: "#555", textAlign: "center",
};

function DefRow({ label, value, labelWidth = 120 }: { label: string; value: React.ReactNode; labelWidth?: number }) {
    return (
        <div style={{ display: "flex", gap: 8, margin: "3px 0" }}>
            <span style={{ color: "#555", minWidth: labelWidth }}>{label}</span>
            <span style={{ flex: 1 }}>{value}</span>
        </div>
    );
}

// `thermal` renders the 80mm-roll layout: single narrow column (boxes and the
// definition labels stack/shrink) instead of the wide A4 side-by-side design.
export function ShippingSlipBody({ data, thermal = false }: { data: ShippingSlipBodyData; thermal?: boolean }) {
    const { party, owner, device } = data;
    const labelW = thermal ? 88 : 120;
    const showSentBy     = data.showSentBy     ?? true;
    const showReceivedBy = data.showReceivedBy ?? true;
    const showPreparedBy = data.showPreparedBy ?? true;
    const showFindings   = data.showFindings   ?? true;
    return (
        <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, margin: "4px 0" }}>
                <span><span style={{ color: "#555" }}>Ticket:</span> <b>{data.ticketNo}</b></span>
                <span><span style={{ color: "#555" }}>Date:</span> {data.date}</span>
            </div>
            {data.ref && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, margin: "3px 0" }}>
                    <span style={{ color: "#555" }}>Service Centre Ref / Job #:</span>
                    <b>{data.ref}</b>
                </div>
            )}

            <div style={{ display: "flex", flexDirection: thermal ? "column" : "row", gap: thermal ? 8 : 12, flexWrap: "wrap", marginTop: 8 }}>
                <div style={{ flex: 1, minWidth: thermal ? "auto" : 150, border: "1px solid #ccc", borderRadius: 4, padding: 8 }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#666", marginBottom: 4 }}>To — Service Centre</div>
                    {party ? (
                        <>
                            <div style={{ fontWeight: 700 }}>{party.name}</div>
                            {party.address && <div style={{ color: "#555", whiteSpace: "pre-line" }}>{party.address}</div>}
                            {party.phone && <div style={{ color: "#555" }}>Ph: {party.phone}</div>}
                        </>
                    ) : (
                        <div style={{ color: "#555" }}>{data.partyNameFallback ?? "—"}</div>
                    )}
                </div>
                <div style={{ flex: 1, minWidth: thermal ? "auto" : 150, border: "1px solid #ccc", borderRadius: 4, padding: 8 }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#666", marginBottom: 4 }}>{data.ownerLabel ?? "Device Owner"}</div>
                    <div style={{ fontWeight: 700 }}>{owner.name}</div>
                    {owner.phone && <div style={{ color: "#555" }}>Ph: {owner.phone}</div>}
                </div>
            </div>

            <div style={{ borderTop: "1px dashed #999", margin: "10px 0" }} />

            <DefRow label="Device Type" value={device.type || "—"} labelWidth={labelW} />
            <DefRow label="Brand" value={device.brand || "—"} labelWidth={labelW} />
            <DefRow label="Model" value={device.model || "—"} labelWidth={labelW} />
            <DefRow label="Reported Problem" value={device.problem || "—"} labelWidth={labelW} />
            {data.accessories && <DefRow label="Accessories Sent" value={data.accessories} labelWidth={labelW} />}
            {data.condition && <DefRow label="Physical Condition" value={data.condition} labelWidth={labelW} />}

            {!data.hasSlip && (
                <p style={{ color: "#555", textAlign: "center", fontSize: 11, marginTop: 8 }}>
                    No service slip saved for this ticket yet — showing the ticket&apos;s device details.
                </p>
            )}

            {/* Signature row — Received by (Service Centre) and Sent by (Shop) on
                the same line, each with its own independent toggle. */}
            {(showReceivedBy || showSentBy) && (
                <div style={{ display: "flex", flexDirection: thermal ? "column" : "row", justifyContent: "space-between", gap: thermal ? 26 : 24, marginTop: thermal ? 30 : 40 }}>
                    {showReceivedBy && <div style={thermal ? SIGN_COL_THERMAL : SIGN_COL}>Received by / Service Centre</div>}
                    {showSentBy && <div style={thermal ? SIGN_COL_THERMAL : SIGN_COL}>{data.sentByLabel?.trim() || "Sent by (Shop)"}</div>}
                </div>
            )}

            {showPreparedBy && data.preparedBy && (
                <p style={{ textAlign: "center", color: "#555", fontSize: 10, marginTop: 8 }}>Prepared by {data.preparedBy}.</p>
            )}

            {/* "For Service Centre use" part — findings write-area + the return
                note, both under one toggle. */}
            {showFindings && (
                <div style={{ marginTop: 18 }}>
                    <div style={{ border: "1px solid #ccc", borderRadius: 4, padding: "8px 10px" }}>
                        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#666", marginBottom: 8 }}>
                            Findings &amp; Solution — for Service Centre use
                        </div>
                        {[0, 1, 2, 3].map((i) => (
                            <div key={i} style={{ borderBottom: "1px solid #ddd", height: 22 }} />
                        ))}
                    </div>
                    <p style={{ textAlign: "center", marginTop: 8, fontSize: 10, color: "#555" }}>
                        Note: Please return this advice slip along with the device.
                    </p>
                </div>
            )}
        </>
    );
}

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
    device:      { type: string; brand: string; model: string; problem: string };
    accessories: string | null;
    condition:   string | null;
    notes:       string | null;
    /** False → no slip snapshot saved yet (shows a hint). */
    hasSlip:     boolean;
    preparedBy:  string | null;
}

function DefRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div style={{ display: "flex", gap: 8, margin: "3px 0" }}>
            <span style={{ color: "#555", minWidth: 120 }}>{label}</span>
            <span style={{ flex: 1 }}>{value}</span>
        </div>
    );
}

export function ShippingSlipBody({ data }: { data: ShippingSlipBodyData }) {
    const { party, owner, device } = data;
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

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                <div style={{ flex: 1, minWidth: 150, border: "1px solid #ccc", borderRadius: 4, padding: 8 }}>
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
                <div style={{ flex: 1, minWidth: 150, border: "1px solid #ccc", borderRadius: 4, padding: 8 }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#666", marginBottom: 4 }}>Device Owner</div>
                    <div style={{ fontWeight: 700 }}>{owner.name}</div>
                    {owner.phone && <div style={{ color: "#555" }}>Ph: {owner.phone}</div>}
                </div>
            </div>

            <div style={{ borderTop: "1px dashed #999", margin: "10px 0" }} />

            <DefRow label="Device Type" value={device.type || "—"} />
            <DefRow label="Brand" value={device.brand || "—"} />
            <DefRow label="Model" value={device.model || "—"} />
            <DefRow label="Reported Problem" value={device.problem || "—"} />
            {data.accessories && <DefRow label="Accessories Sent" value={data.accessories} />}
            {data.condition && <DefRow label="Physical Condition" value={data.condition} />}
            {data.notes && <DefRow label="Notes" value={data.notes} />}

            {!data.hasSlip && (
                <p style={{ color: "#555", textAlign: "center", fontSize: 11, marginTop: 8 }}>
                    No shipping slip saved for this ticket yet — showing the ticket&apos;s device details.
                </p>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 40 }}>
                <div style={{ flex: 1, borderTop: "1px solid #000", paddingTop: 3, fontSize: 10, color: "#555", textAlign: "center" }}>Sent by (Shop)</div>
                <div style={{ flex: 1, borderTop: "1px solid #000", paddingTop: 3, fontSize: 10, color: "#555", textAlign: "center" }}>Received by (Service Centre)</div>
            </div>

            {data.preparedBy && (
                <p style={{ textAlign: "center", color: "#555", fontSize: 10, marginTop: 8 }}>Prepared by {data.preparedBy}.</p>
            )}
        </>
    );
}

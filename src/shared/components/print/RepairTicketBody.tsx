/**
 * Repair-ticket / job-receipt body — the device / problem / estimate middle
 * that sits between the shared header and footer chrome of a REPAIR_TICKET
 * print. Pure presentational (no data loading), so it renders identically in:
 *   • /receipt/[id] — the real printout
 *   • the Print Templates settings preview (fed sample data)
 *
 * This is deliberately NOT the generic invoice line-items layout — a repair
 * ticket is a different document, so it carries its own body.
 */

export interface RepairTicketBodyData {
    ticketNo:      string;
    date:          string;
    customer:      { name: string | null; phone: string | null; email: string | null };
    device:        { type: string; brand: string; model: string };
    problem:       string;
    accessories:   string | null; // captured at intake; blank → print a write-in box
    estimatedCost: number | string | null;
    priority:      string;
    createdBy:     string | null;
}

function Divider() {
    return <div style={{ borderTop: "1px dashed #999", margin: "8px 0" }} />;
}
function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, margin: "6px 0 2px" }}>
            {children}
        </div>
    );
}
function InfoRow({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, margin: "3px 0" }}>
            <span style={{ color: "#555" }}>{label}</span>
            <span style={{ fontWeight: bold ? 700 : 400 }}>{value}</span>
        </div>
    );
}

// ── Thermal — 80mm roll strip (the ticket's default format) ──────────────────
// Sections stack down the roll, label/value justified to the two edges.
function ThermalTicket({ data }: { data: RepairTicketBodyData }) {
    const { customer, device } = data;
    return (
        <>
            {/* No status badge — this receipt is handed over at intake, before any
                repair status is meaningful. */}
            <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2 }}>{data.ticketNo}</div>
                <div style={{ fontSize: 10, marginTop: 2 }}>{data.date}</div>
            </div>

            <Divider />
            <SectionTitle>Customer</SectionTitle>
            <InfoRow label="Name" value={customer.name ?? "—"} bold />
            <InfoRow label="Phone" value={customer.phone ?? "—"} />
            {customer.email && <InfoRow label="Email" value={customer.email} />}

            <Divider />
            <SectionTitle>Device</SectionTitle>
            <InfoRow label="Type" value={device.type} />
            <InfoRow label="Brand" value={device.brand} />
            <InfoRow label="Model" value={device.model} />

            <Divider />
            <SectionTitle>Problem</SectionTitle>
            <div style={{ lineHeight: 1.5, fontSize: 11 }}>{data.problem}</div>

            {/* Accessories — captured at intake when noted; otherwise state
                plainly that none were received (protects the shop on collection). */}
            <Divider />
            <SectionTitle>Accessories Received</SectionTitle>
            {data.accessories ? (
                <div style={{ lineHeight: 1.5, fontSize: 11 }}>{data.accessories}</div>
            ) : (
                <div style={{ fontSize: 11, fontStyle: "italic", color: "#555" }}>No accessories received.</div>
            )}

            {data.estimatedCost != null && (
                <>
                    <Divider />
                    <InfoRow label="Estimated Cost" value={`₹ ${data.estimatedCost}`} bold />
                </>
            )}

            <Divider />
            <InfoRow label="Priority" value={data.priority} bold />
            {data.createdBy && <InfoRow label="Created by" value={data.createdBy} />}
        </>
    );
}

// ── A4 — its own wide-page design (NOT the thermal strip stretched) ──────────
// Ticket + date on one line, Customer/Device as side-by-side boxes, Problem and
// Accessories full width, then a meta strip (estimate · priority · created by).
const A4_BOX: React.CSSProperties = { flex: 1, minWidth: 150, border: "1px solid #ccc", borderRadius: 4, padding: 8 };
const A4_BOX_TITLE: React.CSSProperties = { fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#666", marginBottom: 4 };

function A4Row({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
    return (
        <div style={{ display: "flex", gap: 8, margin: "2px 0" }}>
            <span style={{ color: "#555", minWidth: 52 }}>{label}</span>
            <span style={{ fontWeight: bold ? 700 : 400 }}>{value}</span>
        </div>
    );
}

function A4Ticket({ data }: { data: RepairTicketBodyData }) {
    const { customer, device } = data;
    return (
        <>
            <div style={{ textAlign: "center", margin: "6px 0 2px" }}>
                <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 2 }}>{data.ticketNo}</div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{data.date}</div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                <div style={A4_BOX}>
                    <div style={A4_BOX_TITLE}>Customer</div>
                    <A4Row label="Name" value={customer.name ?? "—"} bold />
                    <A4Row label="Phone" value={customer.phone ?? "—"} />
                    {customer.email && <A4Row label="Email" value={customer.email} />}
                </div>
                <div style={A4_BOX}>
                    <div style={A4_BOX_TITLE}>Device</div>
                    <A4Row label="Type" value={device.type} />
                    <A4Row label="Brand" value={device.brand} />
                    <A4Row label="Model" value={device.model} />
                </div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
                <div style={A4_BOX}>
                    <div style={A4_BOX_TITLE}>Reported Problem</div>
                    <div style={{ lineHeight: 1.5 }}>{data.problem}</div>
                </div>
                <div style={A4_BOX}>
                    <div style={A4_BOX_TITLE}>Accessories Received</div>
                    {data.accessories
                        ? <div style={{ lineHeight: 1.5 }}>{data.accessories}</div>
                        : <div style={{ fontStyle: "italic", color: "#555" }}>No accessories received.</div>}
                </div>
            </div>

            {/* Meta strip — estimate / priority / created-by across the width. */}
            <div style={{ display: "flex", gap: "2.5em", flexWrap: "wrap", borderTop: "1px solid #ddd", marginTop: 14, paddingTop: 8 }}>
                {data.estimatedCost != null && (
                    <span><span style={{ color: "#555" }}>Estimated Cost</span> <b>₹ {data.estimatedCost}</b></span>
                )}
                <span><span style={{ color: "#555" }}>Priority</span> <b>{data.priority}</b></span>
                {data.createdBy && <span><span style={{ color: "#555" }}>Created by</span> {data.createdBy}</span>}
            </div>
        </>
    );
}

// Two bespoke layouts — the A4 page and the 80mm strip are different documents
// by design (per the house rule: never stretch the thermal layout onto A4).
export function RepairTicketBody({ data, thermal = false }: { data: RepairTicketBodyData; thermal?: boolean }) {
    return thermal ? <ThermalTicket data={data} /> : <A4Ticket data={data} />;
}

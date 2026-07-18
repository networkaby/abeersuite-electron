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

export function RepairTicketBody({ data }: { data: RepairTicketBodyData }) {
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

            {/* Accessories — captured at intake when noted; otherwise a write-in
                box for the counter to pen in (bag, charger, cover …). */}
            <Divider />
            <SectionTitle>Accessories Received</SectionTitle>
            {data.accessories ? (
                <div style={{ lineHeight: 1.5, fontSize: 11 }}>{data.accessories}</div>
            ) : (
                <>
                    <div style={{ fontSize: 9, color: "#777", marginBottom: 3 }}>e.g. bag, charger, cover, SIM</div>
                    <div style={{ border: "1px solid #999", borderRadius: 3, minHeight: 36 }} />
                </>
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

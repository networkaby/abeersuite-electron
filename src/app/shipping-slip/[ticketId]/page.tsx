import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import PrintToolbar from "@/shared/components/print/PrintToolbar";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { formatDate } from "@/shared/lib/format/formatDate";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { getVoucherTemplate, resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import { resolveTemplateForFormat } from "@/shared/lib/print/voucherTemplateDefaults";

// Shipping slip / delivery challan for sending a device out to a service centre.
// Prints through the shared template-driven renderer (SHIPPING_SLIP kind, A4 by
// default) following the house print rule: the browser fallback offers the A4 /
// thermal picker and each format renders its own template. The slip-specific
// middle (to/owner + device table + signatures) is the custom `body`; the
// header + footer chrome are shared.

// Snapshot shape written by POST /api/tickets/[id]/shipping-slip.
type ShippingSlip = {
    partyAccountId: number;
    partyName: string;
    ref: string | null;
    date: string;
    device: { type: string; brand: string; model: string; problem: string };
    accessories: string | null;
    condition: string | null;
    notes: string | null;
    createdAt: string;
    createdBy: string | null;
};

function DefRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div style={{ display: "flex", gap: 8, margin: "3px 0" }}>
            <span style={{ color: "#555", minWidth: 120 }}>{label}</span>
            <span style={{ flex: 1 }}>{value}</span>
        </div>
    );
}

export default async function ShippingSlipPage({
    params,
    searchParams,
}: {
    params:        Promise<{ ticketId: string }>;
    searchParams?: Promise<{ paper?: string; autoprint?: string }>;
}) {
    const { ticketId } = await params;
    const sp = (await searchParams) ?? {};

    const ticket = await prisma.ticket.findUnique({
        where: { id: Number(ticketId) },
        include: {
            repair: {
                include: {
                    device: {
                        include: {
                            account: {
                                include: {
                                    person: { include: { phones: selectPrimaryPhone } },
                                    company: { include: { phones: selectPrimaryPhone } },
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    if (!ticket?.repair) notFound();

    // Print template — shop header / address / GSTIN / footer, configured on the
    // Print Templates settings page (SHIPPING_SLIP kind).
    const template = await getVoucherTemplate("SHIPPING_SLIP");
    const format = resolvePaperFormat(template, sp.paper);
    const isThermal = format === "THERMAL_80MM";
    const autoPrint = sp.autoprint !== "0";

    const ctx =
        ticket.context && typeof ticket.context === "object" && !Array.isArray(ticket.context)
            ? (ticket.context as Record<string, unknown>)
            : {};
    const slip = ctx.shippingSlip as ShippingSlip | undefined;

    // The device owner (customer) — for reference on the slip.
    const owner = ticket.repair.device.account?.person ?? ticket.repair.device.account?.company;
    const ownerName = owner?.name ?? ticket.repair.device.account?.name ?? "—";
    const ownerPhone = owner?.phones?.[0]?.phone ?? null;

    // The service centre (Sundry-Creditor party) resolved live from the slip's
    // account id — always shows the current name / address / phone.
    let party: { name: string; address: string | null; phone: string | null } | null = null;
    if (slip?.partyAccountId) {
        const acct = await prisma.account.findUnique({
            where: { id: slip.partyAccountId },
            include: {
                person: { include: { phones: selectPrimaryPhone } },
                company: { include: { phones: selectPrimaryPhone } },
            },
        });
        const p = acct?.person ?? acct?.company;
        party = {
            name: acct?.name ?? slip.partyName,
            address: p?.address ?? null,
            phone: p?.phones?.[0]?.phone ?? null,
        };
    }

    const device = slip?.device ?? {
        type: ticket.repair.device.type,
        brand: ticket.repair.device.brand,
        model: ticket.repair.device.model,
        problem: ticket.repair.device.problem,
    };

    const ticketNo = `#${String(ticket.id).padStart(4, "0")}`;

    const sample: ThermalReceiptSample = {
        reference:  ticketNo,
        date:       formatDate(slip?.date ?? ticket.createdAt),
        partyName:  ownerName,
        partyPhone: ownerPhone,
        lines:      [],
        subtotal:   null,
        taxAmount:  null,
        total:      null,
        notes:      null,
    };

    const body = (
        <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, margin: "4px 0" }}>
                <span><span style={{ color: "#555" }}>Ticket:</span> <b>{ticketNo}</b></span>
                <span><span style={{ color: "#555" }}>Date:</span> {formatDate(slip?.date ?? ticket.createdAt)}</span>
            </div>
            {slip?.ref && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, margin: "3px 0" }}>
                    <span style={{ color: "#555" }}>Service Centre Ref / Job #:</span>
                    <b>{slip.ref}</b>
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
                        <div style={{ color: "#555" }}>{slip?.partyName ?? "—"}</div>
                    )}
                </div>
                <div style={{ flex: 1, minWidth: 150, border: "1px solid #ccc", borderRadius: 4, padding: 8 }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#666", marginBottom: 4 }}>Device Owner</div>
                    <div style={{ fontWeight: 700 }}>{ownerName}</div>
                    {ownerPhone && <div style={{ color: "#555" }}>Ph: {ownerPhone}</div>}
                </div>
            </div>

            <div style={{ borderTop: "1px dashed #999", margin: "10px 0" }} />

            <DefRow label="Device Type" value={device.type || "—"} />
            <DefRow label="Brand" value={device.brand || "—"} />
            <DefRow label="Model" value={device.model || "—"} />
            <DefRow label="Reported Problem" value={device.problem || "—"} />
            {slip?.accessories && <DefRow label="Accessories Sent" value={slip.accessories} />}
            {slip?.condition && <DefRow label="Physical Condition" value={slip.condition} />}
            {slip?.notes && <DefRow label="Notes" value={slip.notes} />}

            {!slip && (
                <p style={{ color: "#555", textAlign: "center", fontSize: 11, marginTop: 8 }}>
                    No shipping slip saved for this ticket yet — showing the ticket&apos;s device details.
                </p>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 40 }}>
                <div style={{ flex: 1, borderTop: "1px solid #000", paddingTop: 3, fontSize: 10, color: "#555", textAlign: "center" }}>Sent by (Shop)</div>
                <div style={{ flex: 1, borderTop: "1px solid #000", paddingTop: 3, fontSize: 10, color: "#555", textAlign: "center" }}>Received by (Service Centre)</div>
            </div>

            {slip?.createdBy && (
                <p style={{ textAlign: "center", color: "#555", fontSize: 10, marginTop: 8 }}>Prepared by {slip.createdBy}.</p>
            )}
        </>
    );

    return (
        <ReceiptPreview
            format={format}
            template={template}
            sample={sample}
            body={body}
            toolbar={
                <PrintToolbar
                    bridge={isThermal && autoPrint
                        ? {
                            endpoint: "/print/voucher",
                            payload:  {
                                kind:     "SHIPPING_SLIP",
                                title:    `Shipping slip ${ticketNo}`,
                                sample,
                                template: resolveTemplateForFormat(template, "THERMAL_80MM"),
                            },
                        }
                        : undefined}
                    autoPrint={autoPrint}
                    showFormatPicker
                    currentPaper={format}
                />
            }
            docTitle={`Shipping Slip - Ticket ${ticketNo}`}
        />
    );
}

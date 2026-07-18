import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import PrintToolbar from "@/shared/components/print/PrintToolbar";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { formatDateTime } from "@/shared/lib/format/formatDate";
import { selectPrimaryPhone, selectPrimaryEmail } from "@/shared/lib/prisma/fragments";
import { getVoucherTemplate, resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import { resolveTemplateForFormat } from "@/shared/lib/print/voucherTemplateDefaults";

// Repair ticket / job receipt. Prints through the shared template-driven
// renderer (REPAIR_TICKET kind) following the house print rule: thermal fires
// the combined bridge first and falls back to the browser, where a format
// picker switches A4 / thermal — each format rendering its own template. The
// ticket-specific middle (device / problem / estimate) is supplied as the
// custom `body`; the header + terms + signature + footer chrome are shared.

// ── Small format-neutral body helpers (render fine at 80mm and A4 widths) ─────
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

export default async function ReceiptPage({
    params,
    searchParams,
}: {
    params:        Promise<{ id: string }>;
    searchParams?: Promise<{ paper?: string; autoprint?: string }>;
}) {
    const { id } = await params;
    const sp = (await searchParams) ?? {};

    const ticket = await prisma.ticket.findUnique({
        where: { id: Number(id) },
        include: {
            repair: {
                include: {
                    device: {
                        include: {
                            account: {
                                include: {
                                    person: { include: { phones: selectPrimaryPhone, emails: selectPrimaryEmail } },
                                    company: { include: { phones: selectPrimaryPhone, emails: selectPrimaryEmail } },
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    if (!ticket?.repair) notFound();

    // Print template (org header / GSTIN / address / footer / terms) — the same
    // per-kind registry the vouchers use, so the shop's branding is configured
    // once on the Print Templates settings page.
    const template = await getVoucherTemplate("REPAIR_TICKET");
    const format = resolvePaperFormat(template, sp.paper);
    const isThermal = format === "THERMAL_80MM";
    const autoPrint = sp.autoprint !== "0";

    const { device } = ticket.repair;
    const owner = device.account?.person ?? device.account?.company;
    const account = owner
        ? {
              name: owner.name,
              phone: owner.phones[0]?.phone ?? null,
              email: owner.emails[0]?.email ?? null,
          }
        : null;
    const createdByName = (ticket.createdBy as { userName?: string })?.userName ?? null;
    const ticketNo = `#${String(ticket.id).padStart(4, "0")}`;

    // Minimal sample — the shared header/footer chrome reads reference/date/party;
    // the ticket body below carries everything else. No line-items table.
    const sample: ThermalReceiptSample = {
        reference:  ticketNo,
        date:       formatDateTime(ticket.createdAt),
        partyName:  account?.name ?? null,
        partyPhone: account?.phone ?? null,
        lines:      [],
        subtotal:   null,
        taxAmount:  null,
        total:      null,
        notes:      null,
    };

    const body = (
        <>
            <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2 }}>{ticketNo}</div>
                <div style={{ fontSize: 10, marginTop: 2 }}>{formatDateTime(ticket.createdAt)}</div>
                <div style={{ marginTop: 4 }}>
                    <span style={{ display: "inline-block", border: "1px solid #000", padding: "1px 6px", fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
                        {ticket.status.replace("_", " ")}
                    </span>
                </div>
            </div>

            <Divider />
            <SectionTitle>Customer</SectionTitle>
            <InfoRow label="Name" value={account?.name ?? "—"} bold />
            <InfoRow label="Phone" value={account?.phone ?? "—"} />
            {account?.email && <InfoRow label="Email" value={account.email} />}

            <Divider />
            <SectionTitle>Device</SectionTitle>
            <InfoRow label="Type" value={device.type} />
            <InfoRow label="Brand" value={device.brand} />
            <InfoRow label="Model" value={device.model} />

            <Divider />
            <SectionTitle>Problem</SectionTitle>
            <div style={{ lineHeight: 1.5, fontSize: 11 }}>{device.problem}</div>

            {ticket.repair.estimatedCost != null && (
                <>
                    <Divider />
                    <InfoRow label="Estimated Cost" value={`₹ ${ticket.repair.estimatedCost}`} bold />
                </>
            )}

            <Divider />
            <InfoRow label="Priority" value={ticket.priority} bold />
            {createdByName && <InfoRow label="Created by" value={createdByName} />}
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
                                kind:     "REPAIR_TICKET",
                                title:    `Ticket ${ticketNo}`,
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
            docTitle={`Receipt - Ticket ${ticketNo}`}
        />
    );
}

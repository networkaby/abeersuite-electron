import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import PrintToolbar from "@/shared/components/print/PrintToolbar";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { formatDateTime } from "@/shared/lib/format/formatDate";
import { selectPrimaryPhone, selectPrimaryEmail } from "@/shared/lib/prisma/fragments";
import { getVoucherTemplate, resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import { resolveTemplateForFormat } from "@/shared/lib/print/voucherTemplateDefaults";
import { RepairTicketBody, type RepairTicketBodyData } from "@/shared/components/print/RepairTicketBody";
import { requireStaffPage } from "@/shared/lib/auth/permissions";

// Repair ticket / job receipt. Prints through the shared template-driven
// renderer (REPAIR_TICKET kind) following the house print rule: thermal fires
// the combined bridge first and falls back to the browser, where a format
// picker switches A4 / thermal — each format rendering its own template. The
// ticket-specific middle (device / problem / estimate) is the <RepairTicketBody>
// — its OWN document, not the invoice line-items layout; the header + terms +
// signature + footer chrome are shared.

export default async function ReceiptPage({
    params,
    searchParams,
}: {
    params:        Promise<{ id: string }>;
    searchParams?: Promise<{ paper?: string; autoprint?: string }>;
}) {
    await requireStaffPage();

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

    const bodyData: RepairTicketBodyData = {
        ticketNo,
        date:          formatDateTime(ticket.createdAt),
        customer:      { name: account?.name ?? null, phone: account?.phone ?? null, email: account?.email ?? null },
        device:        { type: device.type, brand: device.brand, model: device.model },
        problem:       device.problem,
        accessories:   ticket.repair.accessories ?? null,
        estimatedCost: ticket.repair.estimatedCost != null ? String(ticket.repair.estimatedCost) : null,
        priority:      ticket.priority,
        createdBy:     createdByName,
    };
    const body = <RepairTicketBody data={bodyData} thermal={isThermal} />;

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
                                // Device / problem / estimate body — the bridge
                                // renders it (sample.lines is empty for a ticket).
                                body:     bodyData,
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

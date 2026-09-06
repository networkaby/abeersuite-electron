import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import { formatDate } from "@/shared/lib/format/formatDate";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { getVoucherTemplate } from "@/shared/lib/print/voucherTemplate";
import ShippingLabel, { type ShippingLabelData, type LabelSize, type LabelFieldFlags } from "@/shared/components/print/ShippingLabel";

// Packet address label for a device sent to a service centre — its own postcard
// document (SERVICE_SHIPPING_LABEL template kind, customisable in Settings →
// Print Templates). Prints on A4 with a cut line so the card is snipped off and
// the rest of the sheet reused. `?n=<seq>` targets a specific send.
type ShippingSlip = {
    partyAccountId: number;
    partyName: string;
    ref: string | null;
    date: string;
    device: { type: string; brand: string; model: string; problem: string };
    seq?: number;
};

export default async function ShippingLabelPage({
    params,
    searchParams,
}: {
    params: Promise<{ ticketId: string }>;
    searchParams?: Promise<{ autoprint?: string; n?: string; size?: string }>;
}) {
    const { ticketId } = await params;
    const sp = (await searchParams) ?? {};
    const initialSize: LabelSize =
        sp.size === "A4" || sp.size === "A5" || sp.size === "THERMAL" || sp.size === "TL100x50" ? sp.size : "A6";

    const ticket = await prisma.ticket.findUnique({
        where: { id: Number(ticketId) },
        include: { repair: { include: { device: true } } },
    });
    if (!ticket?.repair) notFound();

    const ctx =
        ticket.context && typeof ticket.context === "object" && !Array.isArray(ticket.context)
            ? (ticket.context as Record<string, unknown>)
            : {};
    const slips: ShippingSlip[] = Array.isArray(ctx.shippingSlips)
        ? (ctx.shippingSlips as ShippingSlip[])
        : ctx.shippingSlip
            ? [ctx.shippingSlip as ShippingSlip]
            : [];
    const nParam = Number(sp.n);
    const slip =
        Number.isInteger(nParam) && nParam >= 1 && nParam <= slips.length
            ? slips[nParam - 1]
            : slips[slips.length - 1];

    // TO — the service-centre party, resolved live (current name / address / phone).
    let to = { name: slip?.partyName ?? "Service Centre", address: null as string | null, phone: null as string | null };
    if (slip?.partyAccountId) {
        const acct = await prisma.account.findUnique({
            where: { id: slip.partyAccountId },
            include: {
                person: { include: { phones: selectPrimaryPhone } },
                company: { include: { phones: selectPrimaryPhone } },
            },
        });
        const p = acct?.person ?? acct?.company;
        to = {
            name: acct?.name ?? slip.partyName,
            address: p?.address ?? null,
            phone: p?.phones?.[0]?.phone ?? null,
        };
    }

    // FROM + footer — our shop identity, from the customisable label template.
    const template = await getVoucherTemplate("SERVICE_SHIPPING_LABEL");
    const from = {
        name: template.headerLine1,
        address: template.addressBlock?.trim() || null,
        phone: template.phoneLine?.replace(/^Ph:\s*/i, "").trim() || null,
    };

    const dev = slip?.device ?? {
        type: ticket.repair.device.type,
        brand: ticket.repair.device.brand,
        model: ticket.repair.device.model,
        problem: ticket.repair.device.problem,
    };

    const data: ShippingLabelData = {
        from,
        to,
        ticketNo: ticket.repair.ticketNo || `#${String(ticket.id).padStart(4, "0")}`,
        date:     formatDate(slip?.date ?? ticket.createdAt),
        ref:      slip?.ref ?? null,
        device:   `${dev.brand} ${dev.model}`.trim() + (dev.type ? ` (${dev.type})` : ""),
        footer:   template.footerLine?.trim() || null,
    };

    // Which meta lines print — from the template (per format).
    const fields: LabelFieldFlags = {
        showTicket: template.showTicket,   showTicketThermal: template.showTicketThermal,   showTicketTl: template.showTicketTl,
        showDate:   template.showDate,     showDateThermal:   template.showDateThermal,     showDateTl:   template.showDateTl,
        showRef:    template.showRef,      showRefThermal:    template.showRefThermal,      showRefTl:    template.showRefTl,
        showDevice: template.showDevice,   showDeviceThermal: template.showDeviceThermal,   showDeviceTl: template.showDeviceTl,
        showFooter: template.showFooter,   showFooterThermal: template.showFooterThermal,   showFooterTl: template.showFooterTl,
    };

    return <ShippingLabel data={data} autoPrint={sp.autoprint !== "0"} initialSize={initialSize} fields={fields} />;
}

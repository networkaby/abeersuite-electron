import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { getThermalTemplate } from "@/shared/lib/print/voucherTemplate";
import { buildVoucherReceiptSample, type VoucherReceiptSource } from "@/modules/accountancy/lib/voucherReceiptSample";
import { buildPaymentSlipPrint } from "@/modules/accountancy/lib/paymentSlip";

// GET /api/print/thermal/[source]/[id] — the bridge payload for a silent
// thermal print of any Day-Book voucher (inv · gl · je), so the 3-dot
// "Print (thermal)" can send straight to the counter printer without opening
// a page — the same way a POS sale prints. RECEIPT / PAYMENT use the money-slip
// builder (the one /receipt/payment/[id] renders from); everything else the
// generic template-driven sample (the one /receipt/voucher renders from). The
// template is thermal-resolved here, so the paper obeys the Thermal toggles.
//
// Response: { cmd: "print/voucher", payload: { kind, title, sample, template } }

const SOURCES = new Set<VoucherReceiptSource>(["inv", "gl", "je"]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ source: string; id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { source, id } = await params;
    const rawId = Number(id);
    if (!SOURCES.has(source as VoucherReceiptSource) || !Number.isFinite(rawId)) {
        return NextResponse.json({ error: "Unknown voucher" }, { status: 404 });
    }

    if (source === "gl") {
        const slip = await buildPaymentSlipPrint(rawId);
        if (slip) return NextResponse.json({ cmd: "print/voucher", payload: slip.relayPayload });
    }

    const data = await buildVoucherReceiptSample(source as VoucherReceiptSource, rawId);
    if (!data) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });

    const template = await getThermalTemplate(data.kind);
    return NextResponse.json({
        cmd:     "print/voucher",
        payload: { kind: data.kind, title: data.docTitle, sample: data.sample, template },
    });
}

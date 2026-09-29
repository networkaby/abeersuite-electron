import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { buildVoucherBridgePayload, type VoucherReceiptSource } from "@/modules/accountancy/lib/voucherReceiptSample";

// GET /api/print/thermal/[source]/[id] — the bridge payload for a silent
// thermal print of any Day-Book voucher (inv · gl · je), so the 3-dot
// "Print (thermal)" can send straight to the counter printer without opening
// a page — the same way a POS sale prints. The sample is the one the print
// pages render (buildVoucherBridgePayload, voucherReceiptSample.ts). The
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

    const payload = await buildVoucherBridgePayload(source as VoucherReceiptSource, rawId);
    if (!payload) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
    return NextResponse.json({ cmd: "print/voucher", payload });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { emailKindForVoucherType } from "@/shared/lib/email/emailTemplates";
import { emailSendStates, notifyEmail } from "@/shared/lib/email/notifyEmail";

/** Staff only — a customer session never sends. */
async function staff() {
    const { user, response } = await requireAuth();
    if (response) return response;
    if ((user as { kind?: string }).kind === "customer") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return null;
}

// GET /api/bill-notifications/email — per kind, whether "Send email" works now.
export async function GET() {
    const denied = await staff();
    if (denied) return denied;
    return NextResponse.json({ states: await emailSendStates() });
}

const schema = z.object({ source: z.enum(["inv", "uv"]), id: z.number().int().positive() });

const WHY: Record<string, string> = {
    "template off": "This email is switched off on Settings → Email Templates.",
    "email not configured": "Email sending is not set up on this server.",
    "not posted": "Save / post the voucher first.",
    "no party": "This voucher has no customer.",
    "walk-in": "A walk-in has no customer to send to.",
    supplier: "Suppliers are never emailed.",
    "not a customer": "Refund emails go only to customers (Sundry Debtors).",
    "not a customer document": "This kind of voucher is not emailed to customers.",
    "no email": "This customer has no verified email address.",
    "send failed": "The email service refused it — try again later.",
    counter: "Sending works from the office site, not the counter's own server.",
};

// POST /api/bill-notifications/email — staff's "Send email" from a 3-dot menu.
// `inv` = VoucherDetail id, `uv` = UniversalVoucher id. Once per document.
export async function POST(req: Request) {
    const denied = await staff();
    if (denied) return denied;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const uvId = data.source === "uv"
        ? data.id
        : (await prisma.voucherDetail.findUnique({ where: { id: data.id }, select: { universalVoucherId: true } }))?.universalVoucherId ?? null;
    const uv = uvId == null ? null : await prisma.universalVoucher.findUnique({ where: { id: uvId }, select: { type: true } });
    const kind = uv ? emailKindForVoucherType(uv.type) : null;
    if (uvId == null || !uv) return NextResponse.json({ error: WHY["not posted"] }, { status: 422 });
    if (!kind) return NextResponse.json({ error: WHY["not a customer document"] }, { status: 422 });

    const r = await notifyEmail(kind, uvId, { manual: true });
    if (r.status === "skipped") return NextResponse.json({ error: WHY[r.reason ?? ""] ?? "Could not send." }, { status: 422 });
    return NextResponse.json({ result: r.status });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { emailSampleValues, isEmailKind } from "@/shared/lib/email/emailTemplates";
import { getEmailTemplate } from "@/shared/lib/email/emailTemplateStore";
import { sendFilled } from "@/shared/lib/email/notifyEmail";
import { isEmailConfigured } from "@/shared/lib/email/sendEmail";

type RouteCtx = { params: Promise<{ kind: string }> };

const schema = z.object({ email: z.string().trim().email() });

// POST /api/settings/email-templates/[kind]/test — send the SAVED copy, filled
// with sample values, to one address. Works while switched off.
export async function POST(req: Request, { params }: RouteCtx) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    const { kind } = await params;
    if (!isEmailKind(kind)) return NextResponse.json({ error: "Unknown template kind" }, { status: 404 });
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    if (!isEmailConfigured()) return NextResponse.json({ error: "Email sending is not set up on this server." }, { status: 422 });

    const t = await getEmailTemplate(kind);
    const out = await sendFilled(data.email, t.draft, emailSampleValues(kind));
    if (out.error) return NextResponse.json({ error: out.error }, { status: 502 });
    return NextResponse.json({ ok: true });
}

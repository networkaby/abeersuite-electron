import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { SEND_BATCH } from "@/shared/lib/whatsapp/dueReminderTypes";
import { lastRemindedSince, sendDueReminders } from "@/shared/lib/whatsapp/dueReminders";
import { getApprovedWaTemplate, waSendStates } from "@/shared/lib/whatsapp/waTemplateStore";
import { WA_TEMPLATE_DEFAULTS } from "@/shared/lib/whatsapp/billTemplates";

// GET /api/due-reminders/send — what the Receivables dialogs need before a send:
// who was reminded in the last 30 days, and whether each template can go yet.
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_REMINDERS_SEND);
    if (response) return response;
    const [lastReminded, states, soft, firm] = await Promise.all([
        lastRemindedSince(30),
        waSendStates(),
        getApprovedWaTemplate("DUE_SOFT"),
        getApprovedWaTemplate("DUE_FIRM"),
    ]);
    return NextResponse.json({
        lastReminded,
        templates: {
            SOFT: { state: states.DUE_SOFT, body: soft?.draft.body ?? WA_TEMPLATE_DEFAULTS.DUE_SOFT.body },
            FIRM: { state: states.DUE_FIRM, body: firm?.draft.body ?? WA_TEMPLATE_DEFAULTS.DUE_FIRM.body },
        },
    });
}

const schema = z.object({
    accountIds: z.array(z.number().int().positive()).min(1).max(SEND_BATCH),
    tone: z.enum(["SOFT", "FIRM"]),
    mode: z.enum(["MANUAL", "ALL"]),
});

// POST /api/due-reminders/send — one customer (MANUAL) or one batch of Send to
// all (ALL; the screen loops, SEND_BATCH at a time, and shows the progress).
export async function POST(req: Request) {
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    const { user, response } = await requirePermission(
        data.mode === "ALL" ? PERMISSIONS.ACCOUNTANCY_REMINDERS_SEND_ALL : PERMISSIONS.ACCOUNTANCY_REMINDERS_SEND,
    );
    if (response) return response;
    const sentById = Number(user?.id) || null;
    const results = await sendDueReminders(data.accountIds, data.tone, data.mode, sentById);
    return NextResponse.json({ results });
}

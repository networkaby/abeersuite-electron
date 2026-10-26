import { NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { requireScheduledPage } from "@/modules/campaigns/lib/campaignAccess";
import { excludeFromReminders } from "@/shared/lib/whatsapp/dueReminders";

const schema = z.object({ accountId: z.number().int().positive() });

// POST /api/due-reminders/exclude — Campaigns → Scheduled's Remove: the party goes
// on the Never remind list (undo on Campaigns → Due Reminders).
export async function POST(req: Request) {
    const { response } = await requireScheduledPage();
    if (response) return response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    await excludeFromReminders(data.accountId);
    return NextResponse.json({ ok: true });
}

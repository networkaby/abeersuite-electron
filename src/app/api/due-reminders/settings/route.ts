import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { getReminderSettings, recentReminders, saveReminderSettings } from "@/shared/lib/whatsapp/dueReminders";

// GET /api/due-reminders/settings — Settings → Due Reminders: the switch, rules,
// never-remind list and the recent sends.
export async function GET() {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    const [settings, log] = await Promise.all([getReminderSettings(), recentReminders(50)]);
    return NextResponse.json({ settings, log });
}

const rule = z.object({
    id: z.number().int(),
    name: z.string().trim().min(1).max(60),
    minDays: z.number().int().min(0).max(3650),
    minAmount: z.number().min(0).max(1e9),
    repeatDays: z.number().int().min(0).max(365),
    action: z.enum(["SOFT", "FIRM", "CALL_LIST"]),
    enabled: z.boolean(),
});

const schema = z.object({
    enabled: z.boolean(),
    sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    skipDays: z.array(z.number().int().min(0).max(6)).max(7),
    dailyCap: z.number().int().min(1).max(1000),
    minBalance: z.number().min(0).max(1e9),
    excludedAccountIds: z.array(z.number().int().positive()).max(2000),
    rules: z.array(rule).max(20),
});

// PUT /api/due-reminders/settings — save the whole page.
export async function PUT(req: Request) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    const settings = await saveReminderSettings({ ...data, skipDays: [...new Set(data.skipDays)] });
    return NextResponse.json({ settings });
}

import { NextResponse } from "next/server";
import { validateRequest } from "@/shared/lib/api";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { ACTING_USER_HEADER, authenticateCounterRequest } from "@/shared/lib/auth/counterRelayAuth";
import { COUNTER_KEY_HEADER, officeNotifySchema, type OfficeNotifyJob } from "@/shared/lib/counter/officeNotify";
import {
    notifyBill,
    notifyDealCreated,
    notifyHelpCreated,
    notifyRepair,
    notifyTicketTemplate,
    type NotifyResult,
} from "@/shared/lib/whatsapp/notifyBill";
import { notifyEmail, notifyTicketEmail } from "@/shared/lib/email/notifyEmail";
import { WA_TEMPLATE_KINDS, isWaKind, type WaTemplateKind } from "@/shared/lib/whatsapp/billTemplates";
import { isEmailAnyKind } from "@/shared/lib/email/emailTemplates";

// POST /api/counter/notify — a WRITE_MODE=live counter asks the office to send a
// customer message for something it just saved (counter/officeNotify.ts). Counter key
// only: no website or phone session opens it. Never on a counter.
export async function POST(req: Request) {
    if (IS_COUNTER_PC) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const caller = await authenticateCounterRequest(new Headers({
        authorization: req.headers.get(COUNTER_KEY_HEADER) ?? "",
        [ACTING_USER_HEADER]: req.headers.get(ACTING_USER_HEADER) ?? "",
    }));
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!caller.ok) return NextResponse.json({ error: caller.error, code: caller.code }, { status: caller.status });

    const { data, error } = await validateRequest(req, officeNotifySchema);
    if (error) return error;
    const result = await run(data);
    return result
        ? NextResponse.json(result)
        : NextResponse.json({ error: "Unknown message kind" }, { status: 400 });
}

async function run(job: OfficeNotifyJob): Promise<NotifyResult | null> {
    switch (job.what) {
        case "bill":
            return (WA_TEMPLATE_KINDS as readonly string[]).includes(job.kind)
                ? notifyBill(job.kind as WaTemplateKind, job.id, { manual: job.manual })
                : null;
        case "bill-email": return notifyEmail(job.kind, job.id, { manual: true });
        case "repair": return notifyRepair(job.kind, job.id, { manual: job.manual });
        case "deal": return notifyDealCreated(job.id);
        case "help": return notifyHelpCreated(job.id);
        case "ticket-wa": return isWaKind(job.kind) ? notifyTicketTemplate(job.kind, job.id) : null;
        case "ticket-email": return isEmailAnyKind(job.kind) ? notifyTicketEmail(job.kind, job.id) : null;
    }
}

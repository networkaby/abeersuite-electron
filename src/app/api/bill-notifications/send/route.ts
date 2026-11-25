import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { notifyRepair, sendManually, type NotifyResult } from "@/shared/lib/whatsapp/notifyBill";
import { waSendStates } from "@/shared/lib/whatsapp/waTemplateStore";

/** Staff only — a customer session never sends. */
async function staff() {
    const { user, response } = await requireAuth();
    if (response) return response;
    if ((user as { kind?: string }).kind === "customer") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return null;
}

// GET /api/bill-notifications/send — per kind, whether staff may send it by hand
// ("ready" = switched on + approved on Settings → WhatsApp Templates) or why not.
// The 3-dot menus grey the item out with the reason. Cached a minute on the server.
export async function GET() {
    const denied = await staff();
    if (denied) return denied;
    return NextResponse.json({ states: await waSendStates() });
}

const schema = z.union([
    z.object({ source: z.enum(["inv", "uv"]), id: z.number().int().positive() }),
    z.object({ ticketId: z.number().int().positive(), kind: z.enum(["REPAIR_RECEIVED", "REPAIR_READY"]) }),
]);

const WHY: Record<string, string> = {
    "template off": "This message is switched off on WhatsApp Templates (or not approved by Meta yet).",
    "not posted": "Save / post the voucher first.",
    "no party": "This voucher has no customer.",
    "walk-in": "A walk-in has no customer to send to.",
    "not a customer": "Refund messages go only to customers (Sundry Debtors).",
    "not a customer document": "This kind of voucher is not sent to customers.",
    "no customer": "This repair has no customer on its device.",
    supplier: "Suppliers are never messaged.",
    counter: "This counter cannot ask the office to send right now — send from the office site.",
    "office not reachable": "The office did not answer — try again later.",
    "office app is older than this counter": "The office site must be updated first — send from the office site.",
    "office refused": "The office did not accept this counter — send from the office site.",
};

// POST /api/bill-notifications/send — staff's "Send on WhatsApp": app
// notification + WhatsApp for one document, once per document.
//   { source: "inv" | "uv", id }        a voucher row from a 3-dot menu
//   { ticketId, kind: "REPAIR_…" }      a repair ticket
export async function POST(req: Request) {
    const denied = await staff();
    if (denied) return denied;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const r: NotifyResult = "ticketId" in data
        ? await notifyRepair(data.kind, data.ticketId, { manual: true })
        : await sendManually(data.source, data.id);

    if (r.status === "skipped") {
        return NextResponse.json({ error: WHY[r.reason ?? ""] ?? "Could not send." }, { status: 422 });
    }
    return NextResponse.json({ result: r.status, wa: r.wa ?? null });
}

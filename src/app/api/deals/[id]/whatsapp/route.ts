import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { parseNumericId } from "@/shared/lib/api/parseNumericId";
import { phoneMatchKey } from "@/shared/lib/format";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { ReplyRefusedError, replyWindowOpen, sendReply } from "@/modules/message/lib/customerMessages";
import { loadTicketCustomer, notifyTicketTemplate } from "@/shared/lib/whatsapp/notifyBill";
import { getApprovedWaTemplate } from "@/shared/lib/whatsapp/waTemplateStore";
import { fillBody, isWaKind } from "@/shared/lib/whatsapp/billTemplates";

// The deal screen's WhatsApp tab.
// GET  ?preview=<kind>  → { phone, window, recent, preview? }
// POST { text } inside the 24h window, or { template } any time.
// Every send is a paid Meta message — gated by messages:reply at the API.

/** The deal's own phone first, else the customer's primary / verified mobile. */
async function dealPhone(dealId: number): Promise<string | null> {
    const deal = await prisma.ticketDeal.findUnique({ where: { ticketId: dealId }, select: { phone: true } });
    const own = phoneMatchKey(deal?.phone);
    if (own) return own;
    const c = await loadTicketCustomer(dealId);
    const ranked = [...(c?.phones ?? [])].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || Number(!!b.verifiedAt) - Number(!!a.verifiedAt));
    for (const p of ranked) { const k = phoneMatchKey(p.phone); if (k) return k; }
    return null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.MESSAGES_REPLY);
    if (response) return response;
    const id = parseNumericId((await params).id);
    if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const phone = await dealPhone(id);
        if (!phone) return NextResponse.json({ phone: null, window: { open: false, closesAt: null }, recent: [] });
        const asked = new URL(req.url).searchParams.get("preview");
        const kind = asked && isWaKind(asked) ? asked : null;
        const [win, recent, preview] = await Promise.all([
            replyWindowOpen(phone),
            prisma.message.findMany({
                where: { phone, spam: false, direction: { in: ["IN", "OUT"] } },
                orderBy: { occurredAt: "desc" },
                take: 3,
                select: { id: true, direction: true, body: true, occurredAt: true },
            }),
            kind ? (async () => {
                const [t, c] = await Promise.all([getApprovedWaTemplate(kind), loadTicketCustomer(id)]);
                return t && c ? fillBody(t.draft.body, c.values) : null;
            })() : Promise.resolve(undefined),
        ]);
        return NextResponse.json({
            phone,
            window: { open: win.open, closesAt: win.closesAt },
            recent: recent.reverse(),
            ...(kind ? { preview } : {}),
        });
    } catch (e) {
        return handleApiError(e, "Failed to load WhatsApp");
    }
}

const sendSchema = z.union([
    z.object({ text: z.string().trim().min(1, "Type a message").max(4000, "Message is too long") }),
    // label = the name staff picked, only for the timeline line.
    z.object({ template: z.string().trim().min(1), label: z.string().trim().max(120).optional() }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.MESSAGES_REPLY);
    if (response) return response;
    const id = parseNumericId((await params).id);
    if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const { data, error } = await validateRequest(req, sendSchema);
        if (error) return error;
        if ("text" in data) {
            const phone = await dealPhone(id);
            if (!phone) return NextResponse.json({ error: "This deal has no mobile number" }, { status: 400 });
            // sendReply stamps the message on this deal and writes its timeline line.
            await sendReply({ phone, text: data.text, userId: user.id, ticketId: id });
            return NextResponse.json({ status: "sent" }, { status: 201 });
        }
        if (!isWaKind(data.template)) return NextResponse.json({ error: "Unknown template" }, { status: 400 });
        const r = await notifyTicketTemplate(data.template, id, { manual: true });
        const name = data.label || data.template;
        const note = r.status === "sent" ? `📲 WhatsApp template sent: "${name}"`
            : r.status === "already" ? `📲 WhatsApp template "${name}" was already sent on this deal`
            : `📲 WhatsApp template "${name}" not sent — ${r.reason ?? "skipped"}`;
        await prisma.ticketLog.create({ data: { ticketId: id, note, author: await buildActorSnapshot(user.id) } });
        if (r.status === "skipped") return NextResponse.json({ error: `Not sent — ${r.reason ?? "skipped"}` }, { status: 409 });
        return NextResponse.json(r, { status: r.status === "sent" ? 201 : 200 });
    } catch (e) {
        if (e instanceof ReplyRefusedError) return NextResponse.json({ error: e.message }, { status: 409 });
        return handleApiError(e, "Failed to send WhatsApp");
    }
}

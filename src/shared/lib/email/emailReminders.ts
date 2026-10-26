import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { formatAmount } from "@/shared/lib/format/moneyInr";
import { REMINDER_AFTER_HOURS, REMINDER_MAX_AGE_DAYS, SHOP_APP_URL, SHOP_CART_URL, PORTAL_URL } from "./emailTemplates";
import { getEmailTemplate } from "./emailTemplateStore";
import { sendTemplatedEmail } from "./notifyEmail";

/**
 * The shop reminder emails, run every 30 minutes by /api/cron/communications:
 *   - Abandoned cart — a signed-in customer's cart untouched for
 *     REMINDER_AFTER_HOURS. Once per cart (ShopCart.id).
 *   - Payment pending — an online-payment order still unpaid after
 *     REMINDER_AFTER_HOURS. Once per order (Ticket id).
 * Neither looks further back than REMINDER_MAX_AGE_DAYS, and a switched-off
 * card costs one cached read. Each run handles at most BATCH of each.
 */
const BATCH = 100;
const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const emailsSelect = { select: { email: true, isPrimary: true, verifiedAt: true } } as const;

type CartLine = { productId: number; quantity: number };

/** Save the device's cart. Same lines as stored = no write, so a page load
 *  never moves updatedAt (the abandoned clock). Empty = row deleted, so the
 *  next cart is a new row with its own reminder. */
export async function saveShopCart(personId: number, lines: CartLine[]): Promise<void> {
    if (!lines.length) {
        await prisma.shopCart.deleteMany({ where: { personId } });
        return;
    }
    const cur = await prisma.shopCart.findUnique({ where: { personId }, select: { lines: true } });
    if (cur && JSON.stringify(cur.lines) === JSON.stringify(lines)) return;
    await prisma.shopCart.upsert({ where: { personId }, create: { personId, lines }, update: { lines } });
}

export async function runEmailReminders(now = new Date()) {
    if (IS_COUNTER_PC) return { carts: 0, payments: 0 };
    const before = new Date(now.getTime() - REMINDER_AFTER_HOURS * 3_600_000);
    const after = new Date(now.getTime() - REMINDER_MAX_AGE_DAYS * 86_400_000);
    const [carts, payments] = await Promise.all([cartReminders(before, after), paymentReminders(before, after)]);
    return { carts, payments };
}

async function alreadyDone(kind: string, ids: number[]): Promise<Set<number>> {
    if (!ids.length) return new Set();
    const rows = await prisma.emailNotification.findMany({
        where: { kind, refId: { in: ids }, status: { not: "failed" } },
        select: { refId: true },
    });
    return new Set(rows.map((r) => r.refId));
}

/** Carts the next run would email — shared by the run and the Scheduled preview. */
async function cartsToRemind(before: Date, after: Date) {
    const carts = await prisma.shopCart.findMany({
        where: { updatedAt: { lt: before, gt: after } },
        select: { id: true, personId: true, lines: true, updatedAt: true },
        orderBy: { updatedAt: "asc" },
        take: BATCH * 2,
    });
    const done = await alreadyDone("CART_ABANDONED", carts.map((c) => c.id));
    return carts.filter((c) => !done.has(c.id)).slice(0, BATCH);
}

/** Unpaid online orders the next run would email — shared by the run and the preview. */
async function ordersToRemind(before: Date, after: Date) {
    const orders = await prisma.ticketOrder.findMany({
        where: {
            legacyStatus: "PENDING_PAYMENT",
            paymentMethod: "ONLINE",
            personId: { not: null },
            ticket: { createdAt: { lt: before, gt: after } },
        },
        select: { ticketId: true, totalPaise: true, ticket: { select: { createdAt: true } }, person: { select: { name: true, emails: emailsSelect } } },
        take: BATCH * 2,
    });
    const done = await alreadyDone("PAYMENT_PENDING", orders.map((o) => o.ticketId));
    return orders.filter((x) => !done.has(x.ticketId)).slice(0, BATCH);
}

export type EmailReminderPreview = {
    kind: "CART_ABANDONED" | "PAYMENT_PENDING";
    /** False = the template is switched off, so nothing of this kind goes. */
    enabled: boolean;
    rows: { refId: number; name: string; amountPaise: number | null; since: Date }[];
};

/** Who the next email run would reach, for Campaigns → Scheduled. Read-only. */
export async function previewEmailReminders(now = new Date()): Promise<EmailReminderPreview[]> {
    if (IS_COUNTER_PC) return [];
    const before = new Date(now.getTime() - REMINDER_AFTER_HOURS * 3_600_000);
    const after = new Date(now.getTime() - REMINDER_MAX_AGE_DAYS * 86_400_000);
    const [cartT, payT] = await Promise.all([getEmailTemplate("CART_ABANDONED"), getEmailTemplate("PAYMENT_PENDING")]);
    const [carts, orders] = await Promise.all([
        cartT.enabled ? cartsToRemind(before, after) : [],
        payT.enabled ? ordersToRemind(before, after) : [],
    ]);
    const people = carts.length
        ? await prisma.person.findMany({ where: { id: { in: carts.map((c) => c.personId) } }, select: { id: true, name: true } })
        : [];
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    return [
        {
            kind: "CART_ABANDONED",
            enabled: cartT.enabled,
            rows: carts.map((c) => ({ refId: c.id, name: nameOf.get(c.personId) ?? "Customer", amountPaise: null, since: c.updatedAt })),
        },
        {
            kind: "PAYMENT_PENDING",
            enabled: payT.enabled,
            rows: orders.map((o) => ({ refId: o.ticketId, name: o.person?.name ?? "Customer", amountPaise: o.totalPaise, since: o.ticket.createdAt })),
        },
    ];
}

async function cartReminders(before: Date, after: Date): Promise<number> {
    if (!(await getEmailTemplate("CART_ABANDONED")).enabled) return 0;
    const todo = await cartsToRemind(before, after);
    if (!todo.length) return 0;

    const people = await prisma.person.findMany({
        where: { id: { in: todo.map((c) => c.personId) } },
        select: { id: true, name: true, emails: emailsSelect },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    let sent = 0;
    for (const c of todo) {
        const p = byId.get(c.personId);
        if (!p) continue;
        const r = await sendTemplatedEmail({
            kind: "CART_ABANDONED",
            refId: c.id,
            emails: p.emails,
            values: () => cartValues(p.name, c.lines as CartLine[]),
        });
        if (r.status === "sent") sent++;
    }
    return sent;
}

async function cartValues(name: string, lines: CartLine[]) {
    const products = await prisma.invProduct.findMany({
        where: { id: { in: lines.map((l) => l.productId) } },
        select: { id: true, name: true, shopSubheading: true, effectiveSalePricePaise: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const known = lines.filter((l) => byId.has(l.productId));
    if (!known.length) return { status: "skipped" as const, reason: "no products" };
    let paise = 0;
    const items = known.map((l) => {
        const p = byId.get(l.productId)!;
        paise += (p.effectiveSalePricePaise ?? 0) * l.quantity;
        return `${l.quantity} × ${p.shopSubheading?.trim() || p.name}`;
    });
    return {
        customer: name,
        items: items.join("\n"),
        total: formatAmount(paise / 100),
        cartLink: SHOP_CART_URL,
        shop: getOrganisation().brandName,
        app: SHOP_APP_URL,
    };
}

async function paymentReminders(before: Date, after: Date): Promise<number> {
    if (!(await getEmailTemplate("PAYMENT_PENDING")).enabled) return 0;
    let sent = 0;
    for (const o of await ordersToRemind(before, after)) {
        if (!o.person) continue;
        const r = await sendTemplatedEmail({
            kind: "PAYMENT_PENDING",
            refId: o.ticketId,
            emails: o.person.emails,
            values: {
                customer: o.person.name,
                billNo: `#${o.ticketId}`,
                amount: formatAmount(o.totalPaise / 100),
                date: day.format(o.ticket.createdAt),
                link: `${PORTAL_URL}/orders`,
                shop: getOrganisation().brandName,
            },
        });
        if (r.status === "sent") sent++;
    }
    return sent;
}

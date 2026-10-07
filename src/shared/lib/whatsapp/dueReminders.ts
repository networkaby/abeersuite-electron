import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { round2 } from "@/shared/lib/format/moneyInr";
import { getOutstandings } from "@/modules/accountancy/lib/outstandings";
import { DUE_LINK_CODE, WA_APP_LINK, WA_BILL_LINK_BASE, type WaTemplateKind } from "./billTemplates";
import { partySelect, sendPushAndWhatsApp } from "./notifyBill";
import type {
    LastReminded,
    ReminderAction,
    ReminderLogRow,
    ReminderMode,
    ReminderRule,
    ReminderSettings,
    ReminderTone,
} from "./dueReminderTypes";

/**
 * Due reminders: tell a customer their whole balance due, by app notification
 * and WhatsApp (DUE_SOFT / DUE_FIRM templates), with a Pay now button that opens
 * My Bills → Outstanding and its UPI pay.
 *
 * Three ways in, one sender (`sendDueReminder`), one log (DueReminderLog):
 *   MANUAL  Receivables → Send on a row
 *   ALL     Receivables → Send reminder to all (the screen sends in batches)
 *   AUTO    the daily job (`runDueReminders`), when a rule matches
 *
 * The amount is always read fresh from the bill-wise outstanding, less any money
 * the party has paid but not yet linked to a bill — never a stored balance.
 */

const KIND: Record<ReminderTone, WaTemplateKind> = { SOFT: "DUE_SOFT", FIRM: "DUE_FIRM" };

const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

// ── What each party owes ────────────────────────────────────────────────────

export type PartyDue = {
    accountId: number;
    name: string;
    balance: number;
    oldestBillDate: string | null;
    oldestDays: number;
};

// The whole Sundry Debtors report is a handful of queries; Send to all asks for
// it once per batch, so it is kept for a minute (and dropped after any send so
// a repeat check sees the fresh log).
let duesCache: { at: number; byId: Map<number, PartyDue> } | null = null;
const DUES_TTL_MS = 60_000;

export async function loadPartyDues(): Promise<Map<number, PartyDue>> {
    if (duesCache && Date.now() - duesCache.at < DUES_TTL_MS) return duesCache.byId;
    const report = await getOutstandings(ACCOUNT_GROUPS.SUNDRY_DEBTORS);
    const oldest = new Map<number, { date: string; days: number }>();
    for (const b of report.bills) {
        if (b.side !== 1) continue;
        const cur = oldest.get(b.accountId);
        if (!cur || b.daysOverdue > cur.days) oldest.set(b.accountId, { date: b.billDate, days: b.daysOverdue });
    }
    const byId = new Map<number, PartyDue>();
    for (const p of report.parties) {
        const balance = round2(p.totalOutstanding - p.toLink);
        if (balance <= 0) continue;
        byId.set(p.accountId, {
            accountId: p.accountId,
            name: p.accountName,
            balance,
            oldestBillDate: oldest.get(p.accountId)?.date ?? null,
            oldestDays: oldest.get(p.accountId)?.days ?? 0,
        });
    }
    duesCache = { at: Date.now(), byId };
    return byId;
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function getReminderSettings(): Promise<ReminderSettings> {
    const [s, rules] = await Promise.all([
        prisma.dueReminderSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
        prisma.dueReminderRule.findMany({ orderBy: [{ minDays: "asc" }, { id: "asc" }] }),
    ]);
    const names = s.excludedAccountIds.length
        ? await prisma.account.findMany({ where: { id: { in: s.excludedAccountIds } }, select: { id: true, name: true } })
        : [];
    const nameById = new Map(names.map((a) => [a.id, a.name]));
    return {
        enabled: s.enabled,
        sendTime: s.sendTime,
        skipDays: s.skipDays,
        dailyCap: s.dailyCap,
        minBalance: Number(s.minBalance),
        excluded: s.excludedAccountIds.filter((id) => nameById.has(id)).map((id) => ({ accountId: id, name: nameById.get(id)! })),
        rules: rules.map(toRule),
        lastRunDate: s.lastRunDate,
    };
}

function toRule(r: { id: number; name: string; minDays: number; minAmount: unknown; repeatDays: number; action: string; enabled: boolean }): ReminderRule {
    return { id: r.id, name: r.name, minDays: r.minDays, minAmount: Number(r.minAmount), repeatDays: r.repeatDays, action: r.action as ReminderAction, enabled: r.enabled };
}

/** Save the whole page in one go: settings row, and the rule list replaced. */
export async function saveReminderSettings(input: Omit<ReminderSettings, "excluded" | "lastRunDate"> & { excludedAccountIds: number[] }): Promise<ReminderSettings> {
    const keep = input.rules.filter((r) => r.id > 0).map((r) => r.id);
    await prisma.$transaction([
        prisma.dueReminderSettings.upsert({
            where: { id: 1 },
            create: { id: 1, enabled: input.enabled, sendTime: input.sendTime, skipDays: input.skipDays, dailyCap: input.dailyCap, minBalance: input.minBalance, excludedAccountIds: input.excludedAccountIds },
            update: { enabled: input.enabled, sendTime: input.sendTime, skipDays: input.skipDays, dailyCap: input.dailyCap, minBalance: input.minBalance, excludedAccountIds: input.excludedAccountIds },
        }),
        prisma.dueReminderRule.deleteMany({ where: { id: { notIn: keep } } }),
        ...input.rules.map((r, i) => {
            const data = { name: r.name, minDays: r.minDays, minAmount: r.minAmount, repeatDays: r.repeatDays, action: r.action, enabled: r.enabled, sortOrder: i };
            return r.id > 0
                ? prisma.dueReminderRule.update({ where: { id: r.id }, data })
                : prisma.dueReminderRule.create({ data });
        }),
    ]);
    return getReminderSettings();
}

// ── Log ─────────────────────────────────────────────────────────────────────

export async function recentReminders(take = 50): Promise<ReminderLogRow[]> {
    const rows = await prisma.dueReminderLog.findMany({ orderBy: { createdAt: "desc" }, take });
    return rows.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        accountId: r.accountId,
        party: r.partyName,
        amount: Number(r.amount),
        action: r.action as ReminderAction,
        mode: r.mode as ReminderMode,
        waStatus: r.waStatus,
        pushStatus: r.pushStatus,
        waError: r.waError,
    }));
}

/** Last reminder per party in the past `days` — the dialogs' "already reminded" warning. */
export async function lastRemindedSince(days: number): Promise<LastReminded> {
    const rows = await prisma.dueReminderLog.findMany({
        where: { createdAt: { gte: new Date(Date.now() - days * 86_400_000) }, action: { not: "CALL_LIST" } },
        orderBy: { createdAt: "asc" },
        select: { accountId: true, createdAt: true },
    });
    const out: LastReminded = {};
    for (const r of rows) out[r.accountId] = r.createdAt.toISOString();
    return out;
}

// ── Send ────────────────────────────────────────────────────────────────────

export type SendResult = { accountId: number; status: "sent" | "skipped"; reason?: string; waStatus?: string };

export async function sendDueReminder(args: {
    accountId: number;
    action: ReminderAction;
    mode: ReminderMode;
    ruleId?: number | null;
    sentById?: number | null;
    due?: PartyDue;
}): Promise<SendResult> {
    const { accountId } = args;
    try {
        if (IS_COUNTER_PC) return { accountId, status: "skipped", reason: "counter" };
        const due = args.due ?? (await loadPartyDues()).get(accountId);
        if (!due) return { accountId, status: "skipped", reason: "nothing due" };

        const account = await prisma.account.findUnique({ where: { id: accountId }, select: partySelect });
        const party = account?.person ?? account?.company;
        if (!account || !party) return { accountId, status: "skipped", reason: "no customer" };

        const log = {
            accountId,
            partyName: party.name,
            personId: account.personId,
            amount: due.balance,
            action: args.action,
            mode: args.mode,
            ruleId: args.ruleId ?? null,
            sentById: args.sentById ?? null,
        };

        // The owner's call list: recorded, nobody messaged.
        if (args.action === "CALL_LIST") {
            await prisma.dueReminderLog.create({ data: { ...log, pushStatus: "skipped", waStatus: "call-list" } });
            return { accountId, status: "sent", waStatus: "call-list" };
        }

        const kind = KIND[args.action];
        const amountText = money.format(due.balance);
        const since = due.oldestBillDate ? day.format(new Date(due.oldestBillDate)) : day.format(new Date());
        const { mobile, push, wa } = await sendPushAndWhatsApp({
            kind,
            refId: accountId,
            linkCode: DUE_LINK_CODE,
            personId: account.personId,
            phones: party.phones,
            values: {
                customer: party.name,
                billNo: "",
                amount: amountText,
                date: since,
                prevBalance: "",
                balance: "",
                device: "",
                shop: getOrganisation().brandName,
                link: `${WA_BILL_LINK_BASE}${DUE_LINK_CODE}`,
                app: WA_APP_LINK,
            },
            push: {
                title: args.action === "FIRM" ? `Rs ${amountText} due since ${since}` : `Reminder: Rs ${amountText} due`,
                body: "Tap to see your bills and pay by UPI",
            },
            summary: `Due reminder · Rs ${amountText}`,
        });
        await prisma.dueReminderLog.create({
            data: { ...log, mobile, pushStatus: push.status, waStatus: wa.status, waMessageId: wa.messageId ?? null, waError: wa.error ?? null },
        });
        return { accountId, status: "sent", waStatus: wa.status };
    } catch (e) {
        console.error(`[due-reminder] ${accountId} failed`, e);
        return { accountId, status: "skipped", reason: "error" };
    }
}

/** Send to a list — Send to all's batches. Excluded parties are skipped. */
export async function sendDueReminders(accountIds: number[], tone: ReminderTone, mode: ReminderMode, sentById: number | null): Promise<SendResult[]> {
    const [dues, s] = await Promise.all([
        loadPartyDues(),
        prisma.dueReminderSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {}, select: { excludedAccountIds: true } }),
    ]);
    const excluded = new Set(mode === "ALL" ? s.excludedAccountIds : []);
    const out: SendResult[] = [];
    for (const id of accountIds) {
        if (excluded.has(id)) { out.push({ accountId: id, status: "skipped", reason: "excluded" }); continue; }
        out.push(await sendDueReminder({ accountId: id, action: tone, mode, sentById, due: dues.get(id) }));
    }
    return out;
}

// ── The daily job ───────────────────────────────────────────────────────────

const IST = "Asia/Kolkata";

function istNow(now: Date) {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
            .formatToParts(now)
            .map((p) => [p.type, p.value]),
    );
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday };
}

export type RunResult = { ran: boolean; reason?: string; sent?: number; callList?: number; skipped?: number };

/**
 * Called by the hourly tick and the daily Vercel cron. Sends on the first call
 * at or after the send time, once per India day; a day in "Don't send on" is
 * marked done without sending.
 */
export async function runDueReminders(now = new Date()): Promise<RunResult> {
    if (IS_COUNTER_PC) return { ran: false, reason: "counter" };
    const s = await prisma.dueReminderSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    if (!s.enabled) return { ran: false, reason: "off" };
    const t = istNow(now);
    if (s.lastRunDate === t.date) return { ran: false, reason: "already ran today" };
    if (t.time < s.sendTime) return { ran: false, reason: `waiting for ${s.sendTime}` };

    // Claim the day first, so two ticks arriving together cannot both send.
    const claimed = await prisma.dueReminderSettings.updateMany({
        where: { id: 1, OR: [{ lastRunDate: null }, { lastRunDate: { not: t.date } }] },
        data: { lastRunDate: t.date },
    });
    if (claimed.count === 0) return { ran: false, reason: "already ran today" };
    if (s.skipDays.includes(t.weekday)) return { ran: false, reason: "not a sending day" };

    const rules = (await prisma.dueReminderRule.findMany({ where: { enabled: true } }))
        .map(toRule)
        .sort((a, b) => b.minDays - a.minDays || b.minAmount - a.minAmount);
    if (!rules.length) return { ran: true, sent: 0 };

    duesCache = null;
    const dues = await loadPartyDues();
    const excluded = new Set(s.excludedAccountIds);
    const minBalance = Number(s.minBalance);

    // Every automatic send in the last year, newest first — enough to answer
    // "has this rule already gone to this party for this run of debt".
    const past = await prisma.dueReminderLog.findMany({
        where: { createdAt: { gte: new Date(now.getTime() - 400 * 86_400_000) } },
        orderBy: { createdAt: "desc" },
        select: { accountId: true, ruleId: true, mode: true, createdAt: true },
    });
    const todayStart = new Date(`${t.date}T00:00:00+05:30`);

    let sent = 0, callList = 0, skipped = 0;
    for (const due of dues.values()) {
        if (excluded.has(due.accountId) || due.balance < minBalance) continue;
        // The strongest rule this party matches.
        const rule = rules.find((r) => due.oldestDays >= r.minDays && due.balance >= r.minAmount);
        if (!rule) continue;
        const mine = past.filter((p) => p.accountId === due.accountId);
        // Anything already sent today (by hand or by the job) is enough for today.
        if (mine.some((p) => p.createdAt >= todayStart)) { skipped++; continue; }
        const last = mine.find((p) => p.mode === "AUTO" && p.ruleId === rule.id);
        if (last) {
            // Once per run of debt: a send after the oldest open bill was raised counts.
            const since = rule.repeatDays > 0
                ? new Date(now.getTime() - rule.repeatDays * 86_400_000)
                : due.oldestBillDate ? new Date(due.oldestBillDate) : new Date(0);
            if (last.createdAt >= since) { skipped++; continue; }
        }
        if (rule.action !== "CALL_LIST" && sent >= s.dailyCap) { skipped++; continue; }
        const r = await sendDueReminder({ accountId: due.accountId, action: rule.action, mode: "AUTO", ruleId: rule.id, due });
        if (r.status !== "sent") { skipped++; continue; }
        if (rule.action === "CALL_LIST") callList++; else sent++;
    }
    return { ran: true, sent, callList, skipped };
}

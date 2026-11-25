import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError } from "@/shared/lib/api";
import { requireScheduledPage } from "@/modules/campaigns/lib/campaignAccess";
import { getReminderSettings, previewDueReminders, remindersBetween } from "@/shared/lib/whatsapp/dueReminders";
import { EMAIL_TEMPLATE_LABEL, isEmailKind } from "@/shared/lib/email/emailTemplates";
import { channelTime, channelOf } from "@/modules/campaigns/lib/post";

/**
 * GET /api/campaigns/timeline?from=YYYY-MM-DD&days=3 — Campaigns → Scheduled's
 * timeline: everything sent and everything due, on every channel, by time, for
 * `days` India days from `from` (default: yesterday, 3 days → yesterday, today,
 * tomorrow; at most 14). Read-only.
 *
 * Sent: due reminders (WhatsApp), emails, campaigns, post shares.
 * Due:  scheduled campaigns, scheduled posts (each channel not yet shared) and
 *       each day's automatic due-reminder run at its send time.
 */

export type TimelineItem = {
    id: string;
    at: string;
    channel: "WHATSAPP" | "EMAIL" | "NOTIFICATION" | "SOCIAL";
    state: "sent" | "due" | "failed" | "unclear";
    title: string;
    detail: string;
    href: string | null;
};

const DAY_MS = 86_400_000;
const istDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const istMidnight = (date: string) => new Date(`${date}T00:00:00+05:30`);

export async function GET(req: Request) {
    const { response } = await requireScheduledPage();
    if (response) return response;

    const url = new URL(req.url);
    const fromParam = url.searchParams.get("from");
    const days = Math.min(14, Math.max(1, Number(url.searchParams.get("days")) || 3));
    const fromDate = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : istDate(new Date(Date.now() - DAY_MS));
    const from = istMidnight(fromDate);
    const to = new Date(from.getTime() + days * DAY_MS);

    try {
        const [reminders, emails, campaigns, posts, shares, settings] = await Promise.all([
            remindersBetween(from, to),
            prisma.emailNotification.findMany({
                where: { createdAt: { gte: from, lt: to } },
                select: { id: true, kind: true, email: true, status: true, createdAt: true },
                orderBy: { createdAt: "desc" },
                take: 500,
            }),
            prisma.campaign.findMany({
                where: { OR: [{ status: "SCHEDULED", scheduledAt: { gte: from, lt: to } }, { status: "SENT", sentAt: { gte: from, lt: to } }] },
                select: { id: true, name: true, title: true, status: true, scheduledAt: true, sentAt: true },
            }),
            prisma.post.findMany({
                // scheduledAt is the first channel's time; a later channel copy may still fall in range.
                where: { status: "SCHEDULED", scheduledAt: { lt: to } },
                select: { id: true, caption: true, channels: true, scheduledAt: true, variants: true, shares: { select: { channel: true } } },
            }),
            prisma.postShare.findMany({
                where: { sharedAt: { gte: from, lt: to } },
                select: { id: true, channel: true, sharedAt: true, sharedByName: true, post: { select: { id: true, caption: true } } },
            }),
            getReminderSettings(),
        ]);

        const items: TimelineItem[] = [
            ...reminders.map((l) => ({
                id: `r${l.id}`, at: l.at, channel: "WHATSAPP" as const,
                state: l.waStatus === "failed" ? ("failed" as const) : l.waStatus === "unclear" ? ("unclear" as const) : ("sent" as const),
                title: `Due reminder · ${l.party}`, detail: `₹${l.amount.toLocaleString("en-IN")} · ${l.mode}`, href: null,
            })),
            ...emails.map((e) => ({
                id: `e${e.id}`, at: e.createdAt.toISOString(), channel: "EMAIL" as const,
                state: e.status === "sent" ? ("sent" as const) : e.status === "pending" ? ("due" as const) : ("failed" as const),
                title: isEmailKind(e.kind) ? EMAIL_TEMPLATE_LABEL[e.kind] : e.kind, detail: e.email ?? e.status, href: null,
            })),
            ...campaigns.map((c) => ({
                id: `c${c.id}`, at: (c.status === "SENT" ? c.sentAt : c.scheduledAt)!.toISOString(), channel: "NOTIFICATION" as const,
                state: c.status === "SENT" ? ("sent" as const) : ("due" as const),
                title: c.title, detail: `Campaign · ${c.name}`, href: "/office/campaigns",
            })),
            ...posts.flatMap((p) => {
                // One marker per time: channels sharing a time go together, a copy with its own time stands alone.
                const byTime = new Map<number, string[]>();
                for (const ch of p.channels.filter((c) => !p.shares.some((s) => s.channel === c))) {
                    const at = channelTime(p, ch);
                    if (at && at >= from && at < to) byTime.set(at.getTime(), [...(byTime.get(at.getTime()) ?? []), ch]);
                }
                return [...byTime].map(([at, left]) => ({
                    id: `p${p.id}-${at}`, at: new Date(at).toISOString(), channel: "SOCIAL" as const, state: "due" as const,
                    title: p.caption, detail: `Share on ${left.map((ch) => channelOf(ch)?.label ?? ch).join(", ")}`, href: `/office/campaigns/posts/${p.id}`,
                }));
            }),
            ...shares.map((s) => ({
                id: `s${s.id}`, at: s.sharedAt.toISOString(), channel: "SOCIAL" as const, state: "sent" as const,
                title: s.post.caption, detail: `${channelOf(s.channel)?.label ?? s.channel}${s.sharedByName ? ` · ${s.sharedByName}` : ""}`,
                href: `/office/campaigns/posts/${s.post.id}`,
            })),
        ];

        // The automatic due-reminder run: one "due" marker per remaining sending day in range.
        if (settings.enabled) {
            const today = istDate(new Date());
            const preview = await previewDueReminders();
            for (let i = 0; i < days; i++) {
                const date = istDate(new Date(from.getTime() + i * DAY_MS + DAY_MS / 2));
                if (date < today || (date === today && preview.ranToday)) continue;
                if (settings.skipDays.includes(new Date(`${date}T12:00:00+05:30`).getUTCDay())) continue;
                const reach = date === today ? preview.list.filter((p) => !p.overCap).length : null;
                items.push({
                    id: `run${date}`, at: new Date(`${date}T${settings.sendTime}:00+05:30`).toISOString(), channel: "WHATSAPP", state: "due",
                    title: "Automatic due reminders", detail: reach == null ? "Who is decided on the day" : `${reach} customers`, href: "/office/campaigns/due-reminders",
                });
            }
        }

        items.sort((a, b) => a.at.localeCompare(b.at));
        return NextResponse.json({ from: fromDate, days, items });
    } catch (e) {
        return handleApiError(e, "Failed to load the timeline");
    }
}

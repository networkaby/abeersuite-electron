import type { Prisma } from "@/generated/prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { ResolvedUser } from "@/shared/lib/auth/permissions";
import { passesWorkGate } from "@/modules/repairing/lib/workGate";
import { slaOverdueMs, workLessSlaCandidates } from "@/modules/repairing/lib/resolveTimeSla";
import { getUnreadTotal, getNotificationUnread } from "@/modules/message/lib/inbox";
import {
    PIPELINE_NAV_SURFACES,
    WORK_INBOX_SURFACE,
    type NavCounts,
    type NavCountsPayload,
} from "./navSurfaces";

/** Invalidated whenever a Work or Pipeline is created / edited / deleted. */
export const NAV_MASTERS_TAG = "nav-masters";

/**
 * Works and Pipelines are admin-configured master data — they change a few times a
 * year, but this function runs on a timer for every user on every page. Reading
 * them fresh each tick was the single largest source of database egress in the app,
 * so they are cached and invalidated by tag on write instead. Worst case a newly
 * added Work takes up to `revalidate` seconds to appear in a sidebar badge.
 */
const getNavMasters = unstable_cache(
    async () => {
        const [works, pipelines] = await Promise.all([
            prisma.work.findMany({ select: { id: true, permissionId: true } }),
            prisma.pipeline.findMany({ select: { id: true, name: true } }),
        ]);
        return { works, pipelines };
    },
    ["nav:masters"],
    { tags: [NAV_MASTERS_TAG], revalidate: 600 },
);

/**
 * Cheap "did anything that could move this user's badges happen since X?" check
 * for the poll-and-skip route below. Stateless by design — the caller (browser
 * tab) holds the last payload and its computedAt; this just answers yes/no so a
 * quiet tab costs one small existence check instead of the full recompute.
 * Three sources, since any can change `new` (or chat unread) without the others
 * firing:
 *   • any ticket write (new / edited / moved / snoozed),
 *   • this user marking a surface seen (resets that badge's `new` to zero), or
 *   • a chat message landing in a room this user belongs to.
 *
 * The chat leg matters more than it looks: unlike tickets, chat has its OWN
 * live push (`GlobalInboxListener`'s broadcast → `"inbox:unread"`) — but that
 * push only fires for a message received while a socket was actually open. A
 * message that arrived with nobody connected (see `appChannel.ts`'s liveness
 * gap story) leaves the sidebar's cached total wrong, and a delta check that
 * doesn't look at chat at all would say "unchanged" forever after — the
 * client's stale number can never self-correct. This closes that.
 */
export async function hasNavCountsChangedSince(userId: number, since: Date): Promise<boolean> {
    const [ticket, seen, message] = await Promise.all([
        prisma.ticket.findFirst({ where: { updatedAt: { gt: since } }, select: { id: true } }),
        prisma.userSurfaceSeen.findFirst({ where: { userId, seenAt: { gt: since } }, select: { surface: true } }),
        prisma.chatMessage.findFirst({
            where: { room: { members: { some: { userId } } }, createdAt: { gt: since } },
            select: { id: true },
        }),
    ]);
    return ticket !== null || seen !== null || message !== null;
}

/**
 * Every sidebar count badge in one call, so the whole sidebar polls once instead
 * of once per badge.
 *
 * THE ONE-PLACE RULE — an open ticket is counted in exactly one MODULE-vs-WORK-INBOX
 * badge:
 *   • its MODULE while it sits in a plain status, and
 *   • the WORK INBOX once it lands in a work-bearing sub-status,
 * so the count hands itself over as the ticket moves and nothing is counted twice.
 *
 * Overdue is the deliberate exception. A work-less overdue ticket is still counted
 * in its MODULE — an overdue repair ticket is still an open repair ticket — and is
 * ALSO folded into the Work Inbox as a chase-me notice. Two different lenses (how
 * much open work do I have vs. what needs action now) legitimately show the same
 * ticket; only the module-vs-work-inbox split is exclusive.
 *
 * `all`  — open (non-terminal) tickets in that place.
 * `new`  — of those, the ones that arrived after this user's seen marker. For a
 *          module list "arrived" is `createdAt` (a new deal / enquiry / task /
 *          repair came in); for the Work Inbox it is `statusEnteredAt` (arrival at
 *          a stage), because that queue is about stages, not intake. `new` is
 *          always a subset of `all`, so a badge can never read "5 new · 3 total".
 *
 * Snoozed tickets (`wakeAt` in the future) are in NEITHER badge — a snooze is an
 * explicit "don't bother me until then". They return to the Work Inbox when due.
 *
 * Visibility is per user: the Work Inbox only counts work whose Work-gate the user
 * passes, and a ticket held in work the user cannot act on therefore stays counted
 * in its module for them.
 */
export async function getNavCounts(user: ResolvedUser): Promise<NavCounts> {
    const now = new Date();

    const [{ works, pipelines }, seenRows, slaCandidates] = await Promise.all([
        getNavMasters(),
        prisma.userSurfaceSeen.findMany({
            where: { userId: user.id },
            select: { surface: true, seenAt: true },
        }),
        // Work-less overdue tickets also live in the Work Inbox (as chase-me notices),
        // so the badge must count them. Overdue is a JS decision — Prisma cannot compare
        // `now - statusEnteredAt` against a column — hence the small candidate fetch.
        prisma.ticket.findMany({
            where: workLessSlaCandidates(now),
            select: {
                id: true, statusEnteredAt: true, updatedAt: true,
                ticketStatus: { select: { resolveTimeHours: true } },
            },
        }),
    ]);

    const slaOverdue = slaCandidates.filter(
        (t) => slaOverdueMs(t, t.ticketStatus?.resolveTimeHours, now.getTime()) > 0
    );

    const seenBySurface = new Map(seenRows.map((r) => [r.surface, r.seenAt]));
    const pipelineIdByName = new Map(pipelines.map((p) => [p.name, p.id]));

    // surface key ← pipeline id, for both the query filter and reading results back.
    const surfaceByPipelineId = new Map<string, string>();
    for (const s of PIPELINE_NAV_SURFACES) {
        const id = s.pipelineId ?? (s.pipelineName ? pipelineIdByName.get(s.pipelineName) : undefined);
        if (id) surfaceByPipelineId.set(id, s.key);
    }

    const visibleWorkIds = works.filter((w) => passesWorkGate(user, w)).map((w) => w.id);

    // A snooze defers the item out of every badge until wakeAt passes.
    const notSnoozed: Prisma.TicketWhereInput = { OR: [{ wakeAt: null }, { wakeAt: { lte: now } }] };
    // Sitting in a work-bearing sub-status this user can act on = the Work Inbox owns it.
    const inMyWorkInbox: Prisma.TicketWhereInput = { ticketWorker: { workId: { in: visibleWorkIds } } };

    const moduleBase: Prisma.TicketWhereInput = {
        AND: [
            {
                pipelineId: { in: [...surfaceByPipelineId.keys()] },
                ticketStatus: { isTerminal: false },
            },
            notSnoozed,
            // The one-place rule: hand the ticket over to the Work Inbox badge —
            // but only for tickets actually claimed into work. Overdue is not a
            // hand-off: a work-less overdue ticket stays counted here too (see the
            // note above), so there is deliberately no exclusion for `slaOverdue`.
            ...(visibleWorkIds.length ? [{ NOT: inMyWorkInbox }] : []),
        ],
    };

    // One clause per surface, so a single groupBy resolves every module's `new`
    // against its own marker. No marker = never looked = all of them are new.
    const freshClauses: Prisma.TicketWhereInput[] = [...surfaceByPipelineId].map(([pipelineId, key]) => {
        const seenAt = seenBySurface.get(key);
        return seenAt ? { pipelineId, createdAt: { gt: seenAt } } : { pipelineId };
    });

    const workInboxBase: Prisma.TicketWhereInput = {
        AND: [{ ticketStatus: { isTerminal: false } }, inMyWorkInbox, notSnoozed],
    };
    const workSeenAt = seenBySurface.get(WORK_INBOX_SURFACE);
    // Rows predating statusEnteredAt fall back to updatedAt, as the board's age label does.
    const workFresh: Prisma.TicketWhereInput = workSeenAt
        ? {
            OR: [
                { statusEnteredAt: { gt: workSeenAt } },
                { statusEnteredAt: null, updatedAt: { gt: workSeenAt } },
            ],
        }
        : {};

    const hasSurfaces = surfaceByPipelineId.size > 0;
    const hasWork = visibleWorkIds.length > 0;

    const [moduleAll, moduleNew, workAll, workNew] = await Promise.all([
        hasSurfaces ? prisma.ticket.groupBy({ by: ["pipelineId"], where: moduleBase, _count: { _all: true } }) : [],
        hasSurfaces
            ? prisma.ticket.groupBy({
                by: ["pipelineId"],
                where: { AND: [moduleBase, { OR: freshClauses }] },
                _count: { _all: true },
            })
            : [],
        hasWork ? prisma.ticket.count({ where: workInboxBase }) : 0,
        hasWork ? prisma.ticket.count({ where: { AND: [workInboxBase, workFresh] } }) : 0,
    ]);

    // Work-less overdue rows use the same freshness rule as the work-bearing ones:
    // entered its current status after the last time this user opened the board.
    const slaNew = workSeenAt
        ? slaOverdue.filter((t) => (t.statusEnteredAt ?? t.updatedAt) > workSeenAt).length
        : slaOverdue.length;

    const counts: NavCounts = {
        [WORK_INBOX_SURFACE]: { all: workAll + slaOverdue.length, new: workNew + slaNew },
    };
    for (const key of surfaceByPipelineId.values()) counts[key] = { all: 0, new: 0 };

    for (const row of moduleAll) {
        const key = row.pipelineId ? surfaceByPipelineId.get(row.pipelineId) : undefined;
        if (key) counts[key].all = row._count._all;
    }
    for (const row of moduleNew) {
        const key = row.pipelineId ? surfaceByPipelineId.get(row.pipelineId) : undefined;
        if (key) counts[key].new = row._count._all;
    }

    return counts;
}

/**
 * Everything the sidebar polls for, in one response — surface badges plus the chat
 * unread and notification-bell counts, which used to run pollers of their own.
 */
export async function getNavCountsPayload(user: ResolvedUser): Promise<NavCountsPayload> {
    const [surfaces, inboxUnread, notificationUnread] = await Promise.all([
        getNavCounts(user),
        getUnreadTotal(user),
        getNotificationUnread(user.id),
    ]);
    return { surfaces, inboxUnread, notificationUnread };
}

/** Stamp "I have looked at this list now" — resets the `new` half for this user. */
export async function markSurfaceSeen(userId: number, surface: string) {
    await prisma.userSurfaceSeen.upsert({
        where: { userId_surface: { userId, surface } },
        update: { seenAt: new Date() },
        create: { userId, surface, seenAt: new Date() },
    });
}

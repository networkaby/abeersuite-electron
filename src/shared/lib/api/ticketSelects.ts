/**
 * Position a ticket-shaped row (deal, admin task, help ticket, recurrence) is
 * assigned to, plus its current live holders (resolved via UserPosition), so a
 * board can show who will actually do the work. One select, four routes.
 */
export const ASSIGNED_POSITION_SELECT = {
    select: {
        id: true,
        title: true,
        branch: { select: { name: true } },
        department: { select: { name: true } },
        holders: { select: { user: { select: { id: true, name: true, avatarUrl: true, role: true } } } },
    },
} as const;

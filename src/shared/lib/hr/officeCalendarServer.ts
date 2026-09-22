/**
 * The shop's calendar, read from the database — hours, weekly offs and holidays.
 *
 * Server-only: it touches Prisma, so it must never be imported from a client
 * component. The pure maths it feeds lives in `seasonalHours.ts`, which stays
 * importable from anywhere.
 *
 * One loader rather than three queries scattered across routes, because every
 * caller wants the same three facts together — the attendance register grading a
 * month, the login screen working out the next opening — and the holiday lookup in
 * particular is easy to get subtly wrong (a `date` column is midnight UTC, and
 * comparing it as an instant walks a day backwards in IST).
 */

import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    SHOP_SEASONAL_FALLBACK,
    shopDateOf,
    type OfficeCalendar,
    type SeasonalHours,
} from "./seasonalHours";

/** The shop's configured hours, or the flat defaults when the row is missing. */
export async function loadSeasonalHours(): Promise<SeasonalHours> {
    const row = await prisma.orgDefaults.findUnique({
        where: { id: 1 },
        select: { dutySummerStart: true, dutyWinterStart: true, dutyEnd: true },
    });
    return {
        summerStart: row?.dutySummerStart || SHOP_SEASONAL_FALLBACK.summerStart,
        winterStart: row?.dutyWinterStart || SHOP_SEASONAL_FALLBACK.winterStart,
        end:         row?.dutyEnd         || SHOP_SEASONAL_FALLBACK.end,
    };
}

/**
 * Holidays in a window, as "YYYY-MM-DD" → name.
 *
 * The `date` column is a bare Postgres DATE, which Prisma hands back as midnight
 * UTC. Formatting it with `toISOString().slice(0,10)` is therefore correct and
 * `shopDateOf` would be WRONG here — the latter converts an instant into IST,
 * which turns midnight UTC into 05:30 the same day only by luck of the sign. Kept
 * explicit because the two look interchangeable and are not.
 */
export async function loadHolidays(fromIso: string, toIso: string, branchIds: readonly string[] = []): Promise<Record<string, string>> {
    // The org-wide holidays, plus those of the branches asked for. With none
    // asked for — the login screen, which speaks for the shop and not for a
    // person — a branch's holiday does not close the whole shop.
    const rows = await prisma.holiday.findMany({
        where: {
            date: { gte: new Date(`${fromIso}T00:00:00.000Z`), lte: new Date(`${toIso}T00:00:00.000Z`) },
            OR: [{ branchId: null }, { branchId: { in: [...branchIds] } }],
        },
        select: { date: true, name: true },
        orderBy: { date: "asc" },
    });
    const out: Record<string, string> = {};
    for (const r of rows) out[r.date.toISOString().slice(0, 10)] = r.name;
    return out;
}

/**
 * Everything the next-opening question needs, for a window starting today.
 *
 * `lookaheadDays` matches the walk in `nextOfficeDay` — loading a fortnight means
 * the walk can never run past the holidays it was given and silently report a
 * closed day as open.
 */
export async function loadOfficeCalendar(from: Date = new Date(), lookaheadDays = 14, branchIds: readonly string[] = []): Promise<OfficeCalendar> {
    const today = shopDateOf(from);
    const until = new Date(Date.UTC(today.year, today.month - 1, today.day + lookaheadDays, 12))
        .toISOString().slice(0, 10);

    const [seasonal, holidays, row] = await Promise.all([
        loadSeasonalHours(),
        loadHolidays(today.iso, until, branchIds),
        prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { weeklyOff: true } }),
    ]);

    return { seasonal, holidays, weeklyOff: row?.weeklyOff ?? [] };
}

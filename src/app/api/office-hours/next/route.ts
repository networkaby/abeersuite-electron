/**
 * When does the shop open next?
 *
 * Asked by the sign-in screen, so somebody who has just signed out — or arrived to
 * a locked till — is told the next working day and the time it starts, instead of
 * having to remember whose weekly off it is and whether Thursday is a holiday.
 *
 * Unauthenticated, because nobody is signed in when it is asked, and safe to be:
 * every fact it returns is the sort a shop paints on its own door. It says nothing
 * about any person — not who works that day, not whose day off it is, not whether
 * an account exists. The shop's weekly off is a shop fact; a person's own weekly
 * off is on StaffProfile and never reaches here.
 *
 * Read through the ordinary client, which on a counter is the replica, so the till
 * can still answer with the line down. `OrgDefaults` and `holidays` both replicate.
 */

import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { loadOfficeCalendar } from "@/shared/lib/hr/officeCalendarServer";
import { nextOfficeDay, seasonalStartFor, shopDateOf } from "@/shared/lib/hr/seasonalHours";

export async function GET() {
    try {
        const now = new Date();
        const calendar = await loadOfficeCalendar(now);
        const today = shopDateOf(now);

        const isClosedToday =
            calendar.holidays?.[today.iso] !== undefined
            || (calendar.weeklyOff ?? []).includes(today.weekday);

        return NextResponse.json({
            today: {
                iso: today.iso,
                weekday: today.weekday,
                /// Today's opening even when the shop is shut — the screen shows it
                /// only when it is open, but computing it here keeps the client free
                /// of the curve.
                startHhMm: seasonalStartFor(today, calendar.seasonal),
                endHhMm: calendar.seasonal?.end ?? null,
                closed: isClosedToday,
                holidayName: calendar.holidays?.[today.iso] ?? null,
            },
            next: nextOfficeDay(today, calendar),
        });
    } catch (e) {
        return handleApiError(e, "Could not work out the next opening");
    }
}

/**
 * "Closed tomorrow for Durga Puja. Opens Sunday 27 September, 10:55 AM."
 *
 * One builder for both places the sentence appears — the sign-in screen, which
 * asks the shop-wide question with nobody logged in, and the sign-out toast, which
 * asks it for the person leaving. Two copies would drift, and this is exactly the
 * kind of sentence that reads fine in one place and wrong in the other once a
 * holiday lands on somebody's weekly off.
 *
 * Pure: it takes a computed `NextOfficeDay` and returns words.
 */

import { formatHhMmFriendly, weekdayAndDate, weekdayName } from "@/shared/lib/format/formatDate";
import type { ClosedDay, NextOfficeDay } from "./seasonalHours";

/** "Sunday" for tomorrow, "Sunday 27 September" beyond it. */
function dayPhrase(iso: string, todayIso: string): string {
    const near = weekdayName(iso, todayIso);
    return near === "Tomorrow" || near === "Today" ? near.toLowerCase() : weekdayAndDate(iso);
}

/** Why a single day is shut, in words. */
function closedPhrase(day: ClosedDay, todayIso: string): string {
    const when = dayPhrase(day.iso, todayIso);
    return day.why === "holiday" && day.name
        ? `Closed ${when} for ${day.name}.`
        : `Closed ${when}.`;
}

export interface NextOpeningText {
    /** The closure sentence, empty when the shop simply opens tomorrow. */
    closed: string;
    /** The opening sentence — always present. */
    opens: string;
    /** Both, joined. What most callers render. */
    full: string;
}

/**
 * Turn the next working day into the line a person reads.
 *
 * `todayIso` is passed in rather than read from the clock so the sentence is a
 * pure function of its inputs — a screen rendered just before midnight and the
 * server that computed the day then agree, instead of the client quietly deciding
 * it is already tomorrow.
 */
export function nextOpeningText(
    next: NextOfficeDay,
    todayIso: string,
    /**
     * Whose day it is. The shop "opens"; a person is "back on duty" — and the
     * difference is not decoration. The login screen's line is about the premises
     * and applies to whoever is reading it; the duty card's line is about the man
     * who just signed out, whose own day off may differ from the shop's.
     */
    voice: "shop" | "mine" = "shop",
): NextOpeningText {
    const verb = voice === "mine" ? "Back on duty" : "Opens";
    const opens = `${verb} ${dayPhrase(next.iso, todayIso)}, ${formatHhMmFriendly(next.startHhMm)}.`;

    // The closure sentence always anchors on the FIRST closed day, because that is
    // the one the reader is standing in front of. Anchoring on the named holiday
    // instead read as "Closed Saturday for Durga Puja" on a Thursday whose Friday
    // was already a weekly off — true about Saturday, and silent about tomorrow.
    //
    // Names are deduped: a three-day Puja is three rows in the holiday table with
    // one name, and "Puja and Puja and Puja" is how that leaks out.
    const names = [...new Set(next.skipped.filter((d) => d.why === "holiday" && d.name).map((d) => d.name!))];
    const days = next.skipped.length;
    const lead = days > 0 ? dayPhrase(next.skipped[0].iso, todayIso) : "";

    let closed = "";
    if (days === 1) {
        closed = closedPhrase(next.skipped[0], todayIso);
    } else if (days > 1) {
        const span = `Closed ${lead} for ${days} days`;
        closed = names.length ? `${span} — ${names.join(" and ")}.` : `${span}.`;
    }

    return { closed, opens, full: closed ? `${closed} ${opens}` : opens };
}

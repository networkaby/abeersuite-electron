// Demo attendance for ONE person over ONE range — so the Employee Activity cards
// can be read with figures on them before any till has kept a day.
//
// WHY THIS EXISTS. The card shows the whole working of a day: times active,
// duty owed, worked, away, late by, left early, the penalty the lateness cost,
// and the log of every stretch. None of it appears until `AttendanceSpan` rows
// exist, and they are written by the counter's pulse — which means a screen
// built for the shop cannot be looked at anywhere else. This writes a believable
// month so it can be.
//
// IT IS FABRICATED ATTENDANCE ABOUT A REAL PERSON, and it therefore refuses to
// run anywhere but a database on localhost. That is a hard stop, not a warning:
// these rows look exactly like recorded ones, and on the live books they would
// be a lie that pays or docks somebody.
//
// It touches TWO tables and no others — `AttendanceDay` and `AttendanceSpan`.
// Never payroll, never a ledger, never leave. A run replaces whatever it wrote
// before for that person and range, so running it twice is the same as once, and
// `--undo` takes it all away again.
//
// Run:
//   pnpm seed:demo-attendance --user 40 --from 2026-09-01 --to 2026-09-22
//   pnpm seed:demo-attendance --user 40 --from 2026-09-01 --to 2026-09-22 --undo
//
//   --dry   say what would be written, write nothing

import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { dutyHoursFor } from "../../src/shared/lib/hr/dutyTime";
import { SHOP_SEASONAL_FALLBACK, shopDateFromIso } from "../../src/shared/lib/hr/seasonalHours";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const rawUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "")
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]$/, "");

/** India is a fixed +05:30 — no daylight saving, so no timezone library is needed. */
const IST_OFFSET_MINUTES = 330;

const pool = new Pool({ connectionString: rawUrl, ssl: false, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function flag(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    if (i === -1) return undefined;
    const v = process.argv[i + 1];
    return v && !v.startsWith("--") ? v : undefined;
}

const undo = process.argv.includes("--undo");
const dry = process.argv.includes("--dry");
const userId = Number(flag("--user"));
const from = flag("--from") ?? "";
const to = flag("--to") ?? "";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/** A shop-clock time on a given day, as the UTC instant the columns store. */
function at(iso: string, minutesOfDay: number): Date {
    return new Date(dayOf(iso).getTime() + (minutesOfDay - IST_OFFSET_MINUTES) * 60_000);
}

function hhmmToMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
}

function daysBetween(a: string, b: string): string[] {
    const out: string[] = [];
    const d = dayOf(a);
    const end = dayOf(b);
    while (d.getTime() <= end.getTime()) { out.push(isoOf(d)); d.setUTCDate(d.getUTCDate() + 1); }
    return out;
}

/**
 * The localhost gate.
 *
 * Deliberately a whitelist of hosts rather than a check for "not Supabase": a
 * new hostname should fail closed. `LOCAL_DATABASE_URL` being set means a counter
 * replica, which must never be seeded at all — see lib/assertNotCounter.ts.
 */
function assertLocalOnly(): void {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(rawUrl);
    if (local && !process.env.LOCAL_DATABASE_URL) return;
    console.error(
        "\n✖ demo-attendance refused to run.\n\n" +
        `  Database : ${rawUrl.replace(/:\/\/[^@]*@/, "://***@") || "(none configured)"}\n` +
        `  LOCAL_DATABASE_URL=${process.env.LOCAL_DATABASE_URL ? "(set)" : "(unset)"}\n\n` +
        "  This script invents attendance for a real person. On anything but a local\n" +
        "  development database those rows are indistinguishable from recorded ones,\n" +
        "  and they would pay or dock somebody. It runs on localhost only.\n",
    );
    process.exit(1);
}

/**
 * What kind of day this is, decided from the date alone so two runs of the same
 * range are identical. The mix is chosen to exercise every branch the card has:
 * an ordinary day, a late one, an early finish, an absence, an office override,
 * and duty on a day the shop was shut.
 */
type Shape =
    | { kind: "worked"; lateBy: number; leftEarlyBy: number; stretches: number }
    | { kind: "absent" }
    | { kind: "office-half" };

function shapeOf(iso: string): Shape {
    const dom = Number(iso.slice(8, 10));
    if (dom % 11 === 3) return { kind: "absent" };
    if (dom % 13 === 5) return { kind: "office-half" };
    return {
        kind: "worked",
        // Late on a few days, and hard enough on two of them to spend the free
        // allowance and reach a real penalty.
        lateBy: dom % 5 === 0 ? 18 : dom % 7 === 0 ? 34 : dom % 9 === 0 ? 52 : 0,
        leftEarlyBy: dom % 6 === 0 ? 40 : 0,
        stretches: (dom % 3) + 2,
    };
}

async function main() {
    assertLocalOnly();

    if (!Number.isInteger(userId) || userId <= 0 || !ISO.test(from) || !ISO.test(to) || to < from) {
        console.error("\n  Usage: pnpm seed:demo-attendance --user <id> --from <yyyy-mm-dd> --to <yyyy-mm-dd> [--undo] [--dry]\n");
        process.exit(1);
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true, name: true,
            staffProfile: { select: { dutyStart: true, dutyEnd: true, weeklyOff: true, joinedOn: true, leftOn: true } },
        },
    });
    if (!user) { console.error(`\n  No user ${userId}.\n`); process.exit(1); }

    const where = { userId, date: { gte: dayOf(from), lte: dayOf(to) } };

    console.log("\n━━━ demo-attendance ━━━");
    console.log(`  Database : ${rawUrl.replace(/:\/\/[^@]*@/, "://***@")}`);
    console.log(`  Person   : ${user.name} (#${userId})`);
    console.log(`  Range    : ${from} → ${to}`);
    console.log(`  Mode     : ${undo ? "undo" : dry ? "dry run (writes nothing)" : "write"}\n`);

    if (undo) {
        if (dry) {
            const [d, s] = await Promise.all([
                prisma.attendanceDay.count({ where }),
                prisma.attendanceSpan.count({ where }),
            ]);
            console.log(`  Would delete ${d} day rows and ${s} stretches.\n`);
            return;
        }
        const spans = await prisma.attendanceSpan.deleteMany({ where });
        const days = await prisma.attendanceDay.deleteMany({ where });
        console.log(`  Deleted ${days.count} day rows and ${spans.count} stretches.\n`);
        return;
    }

    // Everything the shop's calendar says about these days, read once.
    const [seasonalRow, holidayRows] = await Promise.all([
        prisma.orgDefaults.findUnique({
            where: { id: 1 },
            select: { dutySummerStart: true, dutyWinterStart: true, dutyEnd: true },
        }),
        prisma.holiday.findMany({
            where: { date: { gte: dayOf(from), lte: dayOf(to) } },
            select: { date: true, name: true },
        }),
    ]);
    // The same three fields `loadSeasonalHours` reads — that loader imports the
    // app's Prisma client, which a seed script must not, so the query is repeated
    // rather than the arithmetic.
    const seasonal = {
        summerStart: seasonalRow?.dutySummerStart || SHOP_SEASONAL_FALLBACK.summerStart,
        winterStart: seasonalRow?.dutyWinterStart || SHOP_SEASONAL_FALLBACK.winterStart,
        end:         seasonalRow?.dutyEnd         || SHOP_SEASONAL_FALLBACK.end,
    };
    const holidays = new Set(holidayRows.map((h) => isoOf(h.date)));
    const offDays = new Set(user.staffProfile?.weeklyOff ?? []);
    const joined = user.staffProfile?.joinedOn ? isoOf(user.staffProfile.joinedOn) : null;
    const left = user.staffProfile?.leftOn ? isoOf(user.staffProfile.leftOn) : null;

    type DayRow = Parameters<typeof prisma.attendanceDay.createMany>[0]["data"];
    const dayRows: DayRow = [];
    const spanRows: Parameters<typeof prisma.attendanceSpan.createMany>[0]["data"] = [];

    // One day of duty on a weekly off, and one on a holiday, so the card's
    // "granted" line has something to say. The first of each in the range.
    const shutDayUsed = { off: false, holiday: false };
    const counted = { worked: 0, absent: 0, office: 0, shut: 0, skipped: 0 };

    for (const iso of daysBetween(from, to)) {
        if (joined && iso < joined) { counted.skipped++; continue; }
        if (left && iso > left) { counted.skipped++; continue; }

        const weekday = dayOf(iso).getUTCDay();
        const isHoliday = holidays.has(iso);
        const isOff = offDays.has(weekday);

        // A day the shop was shut is normally left alone. Exactly one of each gets
        // a worked day, because that is the case the granted-hours line exists for.
        if (isHoliday || isOff) {
            const first = isHoliday ? !shutDayUsed.holiday : !shutDayUsed.off;
            if (!first) { counted.skipped++; continue; }
            if (isHoliday) shutDayUsed.holiday = true; else shutDayUsed.off = true;
            counted.shut++;
        }

        const hours = dutyHoursFor(user.staffProfile?.dutyStart, user.staffProfile?.dutyEnd, {
            on: shopDateFromIso(iso), seasonal,
        });
        const open = hhmmToMinutes(hours.start);
        const close = hhmmToMinutes(hours.end);
        const shape = (isHoliday || isOff)
            // A day the shop was shut is a short, single stretch — somebody came in
            // to finish something, not to work a full duty.
            ? { kind: "worked" as const, lateBy: 75, leftEarlyBy: Math.max(0, close - open - 260), stretches: 1 }
            : shapeOf(iso);

        if (shape.kind === "absent") {
            counted.absent++;
            dayRows.push({ userId, date: dayOf(iso), status: "ABSENT", source: "OFFICE", workedMinutes: 0, note: "did not come in" });
            continue;
        }

        if (shape.kind === "office-half") {
            // The clock says one thing and the office another — the case the card
            // shows both answers for. Real stretches underneath, worth a full day.
            counted.office++;
            const start = open + 5;
            const end = close - 10;
            const minutes = end - start;
            dayRows.push({
                userId, date: dayOf(iso), status: "HALF_DAY", source: "OFFICE", workedMinutes: minutes,
                firstInAt: at(iso, start), lastOutAt: at(iso, end), lastSeenAt: at(iso, end),
                counterId: 1, note: "half day agreed with owner",
            });
            spanRows.push({
                userId, date: dayOf(iso), startedAt: at(iso, start), endedAt: at(iso, end),
                minutes, counterId: 1, endedBy: "SHIFT_CLOSED",
            });
            continue;
        }

        counted.worked++;
        const start = open + shape.lateBy;
        const end = close - shape.leftEarlyBy;

        // The day split into stretches, with a gap of 20–50 minutes between each —
        // the "away" the clock refuses to credit.
        const pieces = shape.stretches;
        const gaps = pieces - 1;
        const gapEach = gaps > 0 ? 20 + ((Number(iso.slice(8, 10)) * 7) % 31) : 0;
        const workEach = Math.floor((end - start - gapEach * gaps) / pieces);
        let cursor = start;
        let worked = 0;

        for (let i = 0; i < pieces; i++) {
            const spanStart = cursor;
            const spanEnd = i === pieces - 1 ? end : spanStart + workEach;
            const minutes = spanEnd - spanStart;
            worked += minutes;
            spanRows.push({
                userId, date: dayOf(iso),
                startedAt: at(iso, spanStart), endedAt: at(iso, spanEnd), minutes,
                counterId: (i % 2) + 1,
                endedBy: i === pieces - 1 ? "SHIFT_CLOSED" : i % 2 === 0 ? "IDLE" : "SIGNED_OUT",
            });
            cursor = spanEnd + gapEach;
        }

        dayRows.push({
            userId, date: dayOf(iso), status: "PRESENT", source: "COUNTER", workedMinutes: worked,
            firstInAt: at(iso, start), lastOutAt: at(iso, end), lastSeenAt: at(iso, end), counterId: 1,
        });
    }

    console.log(`  ${dayRows.length} days · ${spanRows.length} stretches`);
    console.log(`    worked ${counted.worked} · absent ${counted.absent} · office-marked ${counted.office} · shop shut ${counted.shut} · left alone ${counted.skipped}\n`);

    if (dry) { console.log("  DRY RUN — nothing written.\n"); return; }

    // Idempotent by replacement: this person, this range, wiped and rewritten.
    // Anything outside the range, or anybody else's, is not touched.
    await prisma.$transaction([
        prisma.attendanceSpan.deleteMany({ where }),
        prisma.attendanceDay.deleteMany({ where }),
        prisma.attendanceDay.createMany({ data: dayRows }),
        prisma.attendanceSpan.createMany({ data: spanRows }),
    ]);

    console.log("  Written. Open /office/hr/activity?user=" + userId + " to read it.\n");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });

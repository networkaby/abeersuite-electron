/**
 * Console UI for the GitHub backup schedule — turn it off/on and set when it runs,
 * without hand-editing cron syntax.
 *
 *   pnpm backup:schedule            interactive menu
 *   pnpm backup:schedule show       print the current schedule and exit
 *   pnpm backup:schedule off        stop scheduled backups
 *   pnpm backup:schedule daily 00:00
 *   pnpm backup:schedule weekly sunday 02:30
 *
 * Times are given in IST and written as UTC, because cron has no timezone and
 * getting that conversion wrong by hand is how a "midnight" backup ends up running
 * at half past five in the morning. Weekly schedules also shift the DAY when the
 * conversion crosses midnight — 00:00 Sunday IST is 18:30 *Saturday* UTC — which is
 * the part that is easiest to get wrong and hardest to notice.
 *
 * This edits .github/workflows/backup.yml only. It does not touch vercel.json or
 * the manual "Back up now" button, so the three ways to start a backup stay
 * independent of each other.
 *
 * GitHub reads the schedule from the committed file on the default branch, so a
 * change here does nothing until you commit and push. The script says so on exit.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const WORKFLOW = ".github/workflows/backup.yml";
const IST_OFFSET_MINUTES = 330;

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

interface Schedule {
    kind: "daily" | "weekly";
    /** Minutes past midnight, IST. */
    istMinutes: number;
    /** 0 = Sunday .. 6 = Saturday, IST. Only for weekly. */
    istWeekday?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const fmtTime = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const titleCase = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/** IST wall-clock -> the UTC cron fields that produce it. */
function toCron(s: Schedule): string {
    // Borrowing a day when the subtraction goes negative is the whole point of
    // doing this in code: 00:00 IST is 18:30 on the PREVIOUS day in UTC.
    const shifted = s.istMinutes - IST_OFFSET_MINUTES;
    const dayBorrow = shifted < 0 ? 1 : 0;
    const utcMinutes = (shifted + 1440) % 1440;

    const head = `${utcMinutes % 60} ${Math.floor(utcMinutes / 60)} * *`;
    if (s.kind === "daily") return `${head} *`;
    return `${head} ${((s.istWeekday ?? 0) - dayBorrow + 7) % 7}`;
}

/** The inverse, so the menu can show what is currently set. */
function fromCron(cron: string): Schedule | null {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [min, hr, , , dow] = parts;
    if (!/^\d+$/.test(min) || !/^\d+$/.test(hr)) return null;

    const total = Number(hr) * 60 + Number(min) + IST_OFFSET_MINUTES;
    const istMinutes = total % 1440;
    const dayCarry = total >= 1440 ? 1 : 0;

    if (dow === "*") return { kind: "daily", istMinutes };
    if (!/^\d$/.test(dow)) return null;
    return { kind: "weekly", istMinutes, istWeekday: (Number(dow) + dayCarry) % 7 };
}

function describe(s: Schedule): string {
    return s.kind === "daily"
        ? `every day at ${fmtTime(s.istMinutes)} IST`
        : `every ${titleCase(DAYS[s.istWeekday ?? 0])} at ${fmtTime(s.istMinutes)} IST`;
}

// -- reading and writing the workflow ---------------------------------------
// Matched on the "schedule:" key rather than parsed as YAML, because the file has
// to keep its comments and formatting, which a parse-and-dump round trip flattens.
//
// Every pattern allows \r?\n. This file is checked out with CRLF endings on
// Windows, and an earlier version anchored on bare \n matched nothing there --
// which showed up as the script cheerfully reporting "turned off" while changing
// not a single byte. Hence also the guard in apply().

const OFF_MARKER = "# Scheduled backups are OFF. Turn them on with: pnpm backup:schedule";

const SCHEDULE_BLOCK =
    /\r?\n([ \t]*)schedule:\r?\n(?:(?:[ \t]*#[^\r\n]*|[ \t]*-[ \t]*cron:[^\r\n]*)\r?\n)*/;
const OFF_BLOCK = /\r?\n[ \t]*# Scheduled backups are OFF[^\r\n]*\r?\n/;
const DISPATCH_KEY = /\r?\n([ \t]*)workflow_dispatch:/;

function readCron(text: string): string | null {
    const block = SCHEDULE_BLOCK.exec(text);
    if (!block) return null;
    return /-[ \t]*cron:[ \t]*["']([^"']+)["']/.exec(block[0])?.[1] ?? null;
}

function writeSchedule(text: string, s: Schedule | null): string {
    // Written back with whatever the file already uses, so changing a schedule does
    // not also rewrite every line ending in the diff.
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const existing = SCHEDULE_BLOCK.test(text);

    if (s === null) {
        if (!existing) return text;
        // Leaving workflow_dispatch behind keeps the manual and app triggers working.
        return text.replace(SCHEDULE_BLOCK, `${eol}$1${OFF_MARKER}${eol}`);
    }

    const block = [
        "",
        `  # Set by \`pnpm backup:schedule\` -- ${describe(s)}.`,
        "  # Cron is always UTC, so the value below is the IST time minus 5:30.",
        '  # GitHub queues scheduled runs and can start them late; treat it as "around".',
        "  schedule:",
        `    - cron: "${toCron(s)}"`,
        "",
    ].join(eol);

    if (existing) return text.replace(SCHEDULE_BLOCK, block);
    if (OFF_BLOCK.test(text)) return text.replace(OFF_BLOCK, block);
    return text.replace(DISPATCH_KEY, `${block}$1workflow_dispatch:`);
}

// -- the console UI ---------------------------------------------------------

function show(): void {
    const cron = readCron(readFileSync(WORKFLOW, "utf8"));
    if (!cron) {
        console.log("\n  Scheduled backup: OFF -- nothing runs automatically from GitHub.\n");
        return;
    }
    const parsed = fromCron(cron);
    console.log(
        `\n  Scheduled backup: ON -- ${parsed ? describe(parsed) : "custom"}   (cron "${cron}" UTC)\n`,
    );
}

function parseTime(input: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
    if (!m) return null;
    const [h, min] = [Number(m[1]), Number(m[2])];
    return h > 23 || min > 59 ? null : h * 60 + min;
}

function parseDay(input: string): number | null {
    const i = DAYS.indexOf(input.trim().toLowerCase());
    return i === -1 ? null : i;
}

function apply(schedule: Schedule | null): void {
    const text = readFileSync(WORKFLOW, "utf8");
    const next = writeSchedule(text, schedule);

    // Never report success without having changed something. The patterns above
    // depend on the workflow's shape, so a restructure of that file could stop them
    // matching -- and a backup tool that silently does nothing is worse than one
    // that fails loudly.
    if (next === text) {
        if (schedule === null && readCron(text) === null) {
            console.log("\n  Scheduled backup is already off. Nothing changed.\n");
            return;
        }
        throw new Error(
            `Could not find the schedule block in ${WORKFLOW}. Nothing was changed -- edit ` +
                "the `on: schedule:` section by hand, or check whether that file was restructured.",
        );
    }

    writeFileSync(WORKFLOW, next, "utf8");

    console.log(
        schedule
            ? `\n  OK  Scheduled backup set to ${describe(schedule)}   (cron "${toCron(schedule)}" UTC)`
            : "\n  OK  Scheduled backup turned off.",
    );
    console.log("      GitHub reads this from the pushed file, so commit and push to apply:\n");
    console.log(`      git add ${WORKFLOW} && git commit -m "chore(backup): change schedule" && git push\n`);
}

async function menu(): Promise<void> {
    const rl = createInterface({ input: stdin, output: stdout });

    // rl.question() never settles once stdin reaches EOF, so a Ctrl-D -- or the
    // script being run with piped input -- would otherwise end the process silently,
    // leaving the user unsure whether anything was changed. Racing the close event
    // turns that into a plain "nothing changed".
    let closed = false;
    rl.on("close", () => {
        closed = true;
    });
    const ask = async (prompt: string): Promise<string | null> => {
        if (closed) return null;
        const answer = await Promise.race([
            rl.question(prompt),
            new Promise<null>((resolve) => rl.once("close", () => resolve(null))),
        ]);
        return answer;
    };

    try {
        show();
        console.log("  1  Turn scheduled backup OFF");
        console.log("  2  Every day, at a time you choose");
        console.log("  3  Once a week, on a day and time you choose");
        console.log("  4  Leave it as it is\n");

        const choice = (await rl.question("  Choose 1-4: ")).trim();
        if (choice === "4" || choice === "") return console.log("\n  Nothing changed.\n");
        if (choice === "1") return apply(null);
        if (choice !== "2" && choice !== "3") {
            return console.log("\n  Not a valid choice. Nothing changed.\n");
        }

        let weekday: number | undefined;
        if (choice === "3") {
            const day = parseDay(await rl.question(`  Which day (${DAYS.join(", ")}): `));
            if (day === null) return console.log("\n  Not a day name. Nothing changed.\n");
            weekday = day;
        }

        const minutes = parseTime((await ask("  Time in IST (HH:MM, e.g. 00:00): ")) ?? "");
        if (minutes === null) return console.log("\n  Time must look like 02:30. Nothing changed.\n");

        apply(
            choice === "2"
                ? { kind: "daily", istMinutes: minutes }
                : { kind: "weekly", istMinutes: minutes, istWeekday: weekday },
        );
    } finally {
        rl.close();
    }
}

async function main(): Promise<void> {
    const [cmd, ...rest] = process.argv.slice(2);

    if (!cmd) return menu();
    if (cmd === "show") return show();
    if (cmd === "off") return apply(null);

    if (cmd === "daily") {
        const minutes = parseTime(rest[0] ?? "");
        if (minutes === null) throw new Error("Usage: pnpm backup:schedule daily HH:MM   (IST)");
        return apply({ kind: "daily", istMinutes: minutes });
    }

    if (cmd === "weekly") {
        const day = parseDay(rest[0] ?? "");
        const minutes = parseTime(rest[1] ?? "");
        if (day === null || minutes === null) {
            throw new Error("Usage: pnpm backup:schedule weekly <day> HH:MM   (IST)");
        }
        return apply({ kind: "weekly", istMinutes: minutes, istWeekday: day });
    }

    throw new Error("Usage: pnpm backup:schedule [show|off|daily HH:MM|weekly <day> HH:MM]");
}

main().catch((e: Error) => {
    console.error(`\n  ${e.message}\n`);
    process.exit(1);
});

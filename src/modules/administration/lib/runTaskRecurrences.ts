import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { addInterval } from "@/shared/lib/format/addInterval";

// ── Recurring-task generator ──────────────────────────────────────────────────
// Materialises due occurrences of every active TaskRecurrence as ordinary task
// Tickets. Called on READ (the Administration board GET) and from the "Generate
// now" button — the repo has no cron, and its established substitute is the
// compute-on-read pattern (Ticket.wakeAt in the Work Inbox, CRM reconnect
// candidates). Nothing here is time-critical: a task materialised late still
// carries its CORRECT dueAt, so it shows correctly overdue.

/** Safety valve for a mistyped anchor (e.g. year 1990). The cursor makes the run
 *  resumable, so a capped run loses nothing — the next sweep continues. */
const MAX_CATCHUP_PER_RUN = 24;

/** Thrown when another concurrent sweep already claimed this occurrence. */
class OccurrenceTaken extends Error {}

type RecurrenceRow = {
    id: number;
    title: string;
    notes: string | null;
    category: string | null;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    pipelineId: string;
    assignedPositionId: string | null;
    unit: string;
    every: number;
    totalCount: number | null;
    anchorAt: Date;
    lastOccurrenceNo: number;
    leadDays: number;
    amountPaise: number | null;
    accountId: number | null;
    createdBy: Prisma.JsonValue;
};

/**
 * Due date of occurrence `n` (1-based) — ALWAYS measured from the anchor, never
 * from the previous occurrence. That is what makes "rent on the 31st" behave:
 * Jan 31 → Feb 28 (clamped) → Mar 31 (recovered), instead of drifting earlier
 * for ever the way previous-occurrence chaining would.
 */
export function occurrenceDueAt(r: Pick<RecurrenceRow, "anchorAt" | "unit" | "every">, n: number): Date {
    return addInterval(r.anchorAt, r.unit, r.every * (n - 1));
}

/** The moment occurrence `n` becomes generatable (its due date, pulled forward
 *  by leadDays). */
function releaseAt(r: RecurrenceRow, n: number): Date {
    return addInterval(occurrenceDueAt(r, n), "day", -r.leadDays);
}

/** The next occurrence this recurrence will produce, or null when it is finished.
 *  Shared with the API so the list page never re-implements the interval math. */
export function nextDueAt(
    r: Pick<RecurrenceRow, "anchorAt" | "unit" | "every" | "totalCount" | "lastOccurrenceNo">,
): Date | null {
    const n = r.lastOccurrenceNo + 1;
    if (r.totalCount !== null && n > r.totalCount) return null;
    return occurrenceDueAt(r, n);
}

/** "#3 of 12" for a fixed instalment count, "Aug 2026" for an endless one. Two
 *  fixed formats rather than a {{n}} placeholder language staff must learn. */
export function buildOccurrenceTitle(
    r: Pick<RecurrenceRow, "title" | "totalCount">,
    n: number,
    dueAt: Date,
): string {
    if (r.totalCount !== null) return `${r.title} — #${n} of ${r.totalCount}`;
    const period = dueAt.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
    return `${r.title} — ${period}`;
}

/**
 * Sweep every active recurrence and create the task Tickets that are now due.
 * Best-effort by contract: callers wrap it in `.catch()` so a generation failure
 * can never break the board.
 */
export async function runTaskRecurrences(): Promise<{ generated: number }> {
    const now = new Date();

    const due = await prisma.taskRecurrence.findMany({
        where: { isActive: true, endedAt: null },
        select: {
            id: true, title: true, notes: true, category: true, priority: true,
            pipelineId: true, assignedPositionId: true, unit: true, every: true,
            totalCount: true, anchorAt: true, lastOccurrenceNo: true, leadDays: true,
            amountPaise: true, accountId: true, createdBy: true,
        },
    });
    if (due.length === 0) return { generated: 0 };

    // Entry-point stage per pipeline, resolved ONCE for the whole sweep.
    const entryByPipeline = new Map<string, string | null>();
    for (const pipelineId of new Set(due.map((r) => r.pipelineId))) {
        const entry = await prisma.ticketStatus.findFirst({
            where: { pipelineId, isEntryPoint: true },
            orderBy: { order: "asc" },
            select: { id: true },
        });
        entryByPipeline.set(pipelineId, entry?.id ?? null);
    }

    let generated = 0;
    for (const r of due) {
        const statusId = entryByPipeline.get(r.pipelineId);
        // A pipeline with no entry-point stage cannot receive tickets. Skip it
        // silently — the board must still render.
        if (!statusId) continue;

        let cursor = r.lastOccurrenceNo;
        for (let made = 0; made < MAX_CATCHUP_PER_RUN; made++) {
            const n = cursor + 1;
            if (r.totalCount !== null && n > r.totalCount) break;
            if (releaseAt(r, n) > now) break;

            try {
                await createOccurrence(r, n, statusId);
                generated++;
                cursor = n;
            } catch (e) {
                // Another concurrent sweep won this occurrence (CAS lost, or the
                // unique index rejected the insert). Stop this recurrence — the
                // winner is creating the rest.
                if (e instanceof OccurrenceTaken) break;
                if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") break;
                throw e;
            }
        }
    }

    return { generated };
}

/** Claim occurrence `n` and create its Ticket, atomically. */
async function createOccurrence(r: RecurrenceRow, n: number, statusId: string): Promise<void> {
    const dueAt = occurrenceDueAt(r, n);
    const isLast = r.totalCount !== null && n === r.totalCount;

    await prisma.$transaction(async (tx) => {
        // Compare-and-swap on the cursor: only the request that sees
        // lastOccurrenceNo === n-1 may create occurrence n. The conditional
        // update takes the row lock, so a concurrent sweep gets count 0 and
        // aborts instead of double-creating.
        const { count } = await tx.taskRecurrence.updateMany({
            where: { id: r.id, lastOccurrenceNo: n - 1 },
            data: { lastOccurrenceNo: n, ...(isLast ? { endedAt: new Date() } : {}) },
        });
        if (count !== 1) throw new OccurrenceTaken();

        await tx.ticket.create({
            data: {
                title: buildOccurrenceTitle(r, n, dueAt),
                notes: r.notes,
                category: r.category,
                priority: r.priority,
                pipelineId: r.pipelineId,
                status: statusId,
                assignedPositionId: r.assignedPositionId,
                accountId: r.accountId,
                dueAt,
                // The recurrence's author, NOT whoever happened to load the board —
                // the sweep is not an actor.
                createdBy: r.createdBy === null ? {} : (r.createdBy as Prisma.InputJsonValue),
                // Display-only decision support; nothing is posted to the ledger.
                ...(r.amountPaise !== null ? { context: { amountPaise: r.amountPaise } } : {}),
                recurrenceId: r.id,
                occurrenceNo: n,
                // workerId stays null — sub-status workers are repair-pipeline
                // vocabulary, and POST /api/admin-tasks does not set one either.
            },
        });
    });
}

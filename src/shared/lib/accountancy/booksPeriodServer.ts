/**
 * Server-side reader for the org's period anchors, and the one date rule built
 * on them: a voucher may not be dated before the books begin here.
 *
 * `BooksConfig.booksBeginningFrom` is the first day whose entries live in this
 * software. Anything earlier belongs to the previous software or the manual
 * register, so a voucher dated before it is not history — it is a second copy
 * of a period that is already closed somewhere else, and it double-counts.
 *
 * ── Why it is cached ─────────────────────────────────────────────────────────
 * Same reasoning as `offlinePoliciesServer.ts` next door, and for the same
 * reason: this runs on EVERY voucher, so a query per voucher would put a round
 * trip in front of every bill at the counter. A books-beginning date is set
 * once in the life of an installation and then never touched, so a minute of
 * staleness cannot matter here at all.
 *
 * ── Why it fails OPEN ────────────────────────────────────────────────────────
 * Null means nobody has stated a start date. The rule is then inert: an
 * installation that has never visited the Year Ending page keeps behaving
 * exactly as it did before this existed. An unreachable database or an
 * un-synced replica must not turn into "no voucher may be saved" either — the
 * till has to keep selling.
 */
import type { PrismaClient } from "@/generated/prisma/client";

/** How long a loaded row stays authoritative before the next read re-fetches it. */
const CACHE_TTL_MS = 60_000;

export interface BooksPeriod {
    /** Start of the first financial year present here. Null = never stated. */
    financialYearFrom: Date | null;
    /** First day whose entries live here. Null = never stated, rule inert. */
    booksBeginningFrom: Date | null;
}

const NO_PERIOD: BooksPeriod = { financialYearFrom: null, booksBeginningFrom: null };

type Cache = { period: BooksPeriod; loadedAt: number };

/** Module state is per-process; the dev server reloads modules, so pin it globally. */
const globalForPeriod = globalThis as unknown as { __booksPeriodCache?: Cache };

/**
 * Only the two columns are read, so a transaction client is as good as the full
 * client — every caller already has one or the other in hand.
 */
type BooksConfigReader = Pick<PrismaClient, "booksConfig">;

/** The org's period anchors, cached for a minute. Fails open to both-null. */
export async function loadBooksPeriod(db: BooksConfigReader): Promise<BooksPeriod> {
    const cached = globalForPeriod.__booksPeriodCache;
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.period;

    let period = NO_PERIOD;
    try {
        const row = await db.booksConfig.findUnique({
            where: { id: 1 },
            select: { financialYearFrom: true, booksBeginningFrom: true },
        });
        if (row) period = { financialYearFrom: row.financialYearFrom, booksBeginningFrom: row.booksBeginningFrom };
    } catch {
        // Left as both-null on purpose — see the fail-open note above.
    }

    globalForPeriod.__booksPeriodCache = { period, loadedAt: Date.now() };
    return period;
}

/**
 * Drop the cached row. Called by the settings PATCH so the admin who just set
 * the date sees it take effect on their very next voucher, instead of watching
 * a stale minute go by and concluding the setting does nothing.
 */
export function invalidateBooksPeriodCache(): void {
    delete globalForPeriod.__booksPeriodCache;
}

/**
 * Thrown when a voucher is dated before the books begin. Carries a sentence
 * written for the person at the counter, not for a log file — `handleApiError`
 * passes it through as a 422.
 */
export class VoucherDateError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VoucherDateError";
    }
}

export function isVoucherDateError(e: unknown): e is VoucherDateError {
    return e instanceof VoucherDateError;
}

/** dd-mm-yyyy, matching how dates are typed and read everywhere in the app. */
function human(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

/**
 * Refuse a voucher dated before the books begin here.
 *
 * The comparison is date-only (`@db.Date` on both sides), and the boundary day
 * itself is ALLOWED — opening balances and opening bills are dated exactly at
 * books-beginning, and they must go in.
 */
export async function assertVoucherDate(db: BooksConfigReader, date: Date): Promise<void> {
    const { booksBeginningFrom } = await loadBooksPeriod(db);
    if (!booksBeginningFrom) return;   // never stated → rule inert

    const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const floor = Date.UTC(
        booksBeginningFrom.getUTCFullYear(),
        booksBeginningFrom.getUTCMonth(),
        booksBeginningFrom.getUTCDate(),
    );
    if (day >= floor) return;

    throw new VoucherDateError(
        `Date ${human(date)} is before the books begin here (${human(booksBeginningFrom)}). ` +
        `That period is in the old books — record it there, not here.`,
    );
}

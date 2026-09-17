import { handleApiError } from "./handleApiError";

/**
 * Wraps a route handler so anything it throws comes back as `handleApiError`'s
 * envelope instead of Next's bare 500.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A route handler that throws gets a 500 with an EMPTY body from Next, and the
 * reason is only in the server console. Every accountancy report route already
 * avoids that with its own `try { … } catch (e) { return handleApiError(e, …) }`;
 * all 19 BI routes had none, so a broken report told the browser nothing at all.
 * That cost a whole debugging session on 2026-09-17: three BI reports answered
 * blank 500s while the real cause — a `P2022 ColumnNotFound` for a column the
 * migration had not yet carried to the database — sat in a terminal nobody was
 * watching.
 *
 * This is the same behaviour the accountancy routes hand-write, in one place, so
 * a route opts in by wrapping rather than by re-indenting its whole body:
 *
 *   export const GET = withApiError("Failed to build the movement register",
 *       async (req: Request) => { … });
 *
 * The fallback is the sentence the BROWSER is allowed to see. The real error
 * stays in the server log — `handleApiError` never leaks it — and its offline,
 * voucher-date and branch-access branches still apply, so a wrapped route keeps
 * answering 503 / 422 / 403 where it should instead of flattening everything
 * to 500.
 */
export function withApiError<A extends unknown[], R extends Response>(
    fallback: string,
    handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | Response> {
    return async (...args: A) => {
        try {
            return await handler(...args);
        } catch (e) {
            return handleApiError(e, fallback);
        }
    };
}

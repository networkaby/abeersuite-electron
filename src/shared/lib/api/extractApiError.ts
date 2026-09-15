import axios from "axios";
import { OFFLINE_READ_ONLY } from "@/shared/lib/prisma/offlineError";
import type { CreditLimitDetail } from "@/shared/lib/accountancy/checkCreditLimit";

/**
 * Pull a server `{ error }` message off an axios error, falling back to `fallback`.
 *
 * Usage:
 *   catch (e) { toast.error(extractApiError(e, "Save failed")); }
 */
export function extractApiError(e: unknown, fallback = "Something went wrong"): string {
    if (axios.isAxiosError(e) && typeof e.response?.data?.error === "string") {
        const { error, message } = e.response.data as { error: string; message?: unknown };
        // An offline refusal carries a wire code in `error` and the human reason in
        // `message`; showing the code as a toast tells the cashier nothing.
        if (error === OFFLINE_READ_ONLY && typeof message === "string" && message) return message;
        return error;
    }
    return fallback;
}

/**
 * The credit-limit figures a sale route sends back when it refuses a sale for
 * want of credit (422 + `creditLimit`). Null for every other failure — including
 * the walk-in refusal, which carries none because no limit can fix it.
 *
 * Usage:
 *   catch (e) { const d = creditLimitDetailOf(e); if (d) openRaiseLimitDialog(d); }
 */
export function creditLimitDetailOf(e: unknown): CreditLimitDetail | null {
    if (!axios.isAxiosError(e)) return null;
    const detail = (e.response?.data as { creditLimit?: unknown } | undefined)?.creditLimit;
    if (!detail || typeof detail !== "object") return null;
    const d = detail as Partial<CreditLimitDetail>;
    return typeof d.accountId === "number" && typeof d.required === "number"
        ? (d as CreditLimitDetail)
        : null;
}

import axios from "axios";
import { OFFLINE_READ_ONLY } from "@/shared/lib/prisma/offlineError";
import type { CreditLimitDetail } from "@/shared/lib/accountancy/checkCreditLimit";
import { StorageUploadError } from "@/shared/lib/storage/signedUpload";

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
    // No `{ error }` from our route: say what did come back, so "Failed to load"
    // on a till tells crash (500) from missing route (404) from no server at all.
    if (axios.isAxiosError(e) && e.code !== "ERR_CANCELED") {
        return e.response ? `${fallback} (${e.response.status})` : `${fallback} (no answer from the server)`;
    }
    // A browser → R2 upload never reaches our server; its reason is already worded.
    if (e instanceof StorageUploadError) return e.message;
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

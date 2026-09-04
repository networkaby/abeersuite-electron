import axios from "axios";
import { OFFLINE_READ_ONLY } from "@/shared/lib/prisma/offlineError";

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

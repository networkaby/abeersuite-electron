import axios from "axios";

/**
 * Pull a server `{ error }` message off an axios error, falling back to `fallback`.
 *
 * Usage:
 *   catch (e) { toast.error(extractApiError(e, "Save failed")); }
 */
export function extractApiError(e: unknown, fallback = "Something went wrong"): string {
    if (axios.isAxiosError(e) && typeof e.response?.data?.error === "string") {
        return e.response.data.error;
    }
    return fallback;
}

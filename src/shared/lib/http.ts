// ── Shared HTTP client — branch-aware axios instance ──────────────────────────
// Every outgoing request is stamped with `x-active-branch` from the Zustand
// store so server-side `resolveActiveBranchId` reads the user's intent directly
// instead of relying on the cookie fallback.
//
// Response interceptor surfaces the two branch-context error codes
// (`no_active_branch`, `select_working_branch`) as explicit toasts so users
// know to pick a branch, instead of seeing a generic "save failed" message.
//
// Migration: components doing transactional work should import `{ http }` from
// this module instead of bare `axios`. Read-only fetches can stay on bare
// `axios` — the cookie fallback continues to work.

import axios, { type InternalAxiosRequestConfig } from "axios";
import { toast } from "sonner";
import { useActiveBranchStore, COMBINED_BRANCH } from "@/store/activeBranchStore";
import { BUSINESS_DATE_HEADER } from "@/shared/lib/constants/business";
import { todayIso } from "@/shared/lib/format/formatDate";

export const http = axios.create();

/** True when the request targets our own origin — a relative URL, or an absolute
 *  one pointing back at this host.
 *
 *  Third-party calls must NOT be stamped. A custom header makes a cross-origin
 *  request "non-simple", so the browser sends a preflight `OPTIONS` first; APIs
 *  that don't allow our private headers reject it and axios reports the opaque
 *  `Network Error`. That is what broke every Cloudinary image upload — the
 *  global interceptor (see `SessionWrapper`) was stamping the upload POST too.
 *  Keeping them same-origin also stops branch id / business date leaking out. */
function isSameOrigin(config: InternalAxiosRequestConfig): boolean {
    try {
        return new URL(config.url ?? "", config.baseURL ?? window.location.origin).origin
            === window.location.origin;
    } catch {
        // Unparseable — treat as one of ours rather than dropping the context.
        return true;
    }
}

/** Stamp `x-active-branch` + `x-business-date` on an outgoing same-origin request.
 *
 *  Exported because most POS/office components still call bare `axios`, so
 *  `SessionWrapper` registers this on the global instance too — otherwise a
 *  staff entry made through bare axios would silently fall back to the server's
 *  idea of today. */
export function stampRequestContext(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
    if (typeof window === "undefined") return config;
    if (!isSameOrigin(config)) return config;
    config.headers = config.headers ?? {};
    const branchId = useActiveBranchStore.getState().activeBranchId;
    if (branchId) {
        // Send the sentinel as-is; the server distinguishes combined from a real branch id.
        config.headers["x-active-branch"] = branchId;
    }
    // The staff machine's calendar day — the shop's real date, and the same one
    // TallyDate resolves when the user types "t". Server routes use it for
    // records with no date field; see `requestBusinessDate()`.
    config.headers[BUSINESS_DATE_HEADER] = todayIso();
    return config;
}

http.interceptors.request.use(stampRequestContext);

http.interceptors.response.use(
    (res) => res,
    (err: unknown) => {
        if (axios.isAxiosError(err)) {
            const code = (err.response?.data as { error?: string } | undefined)?.error;
            if (code === "no_active_branch") {
                toast.error("Select a working branch to continue.");
            } else if (code === "select_working_branch") {
                toast.error("Switch from 'My branches' to a specific branch to post this transaction.");
            } else if (code === "forbidden_branch") {
                toast.error("You don't have access to that branch.");
            }
        }
        return Promise.reject(err);
    },
);

export { COMBINED_BRANCH };

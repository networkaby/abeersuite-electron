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
//
// Registered in docs/reusables.md.

import axios from "axios";
import { toast } from "sonner";
import { useActiveBranchStore, COMBINED_BRANCH } from "@/store/activeBranchStore";

export const http = axios.create();

http.interceptors.request.use((config) => {
    if (typeof window === "undefined") return config;
    const branchId = useActiveBranchStore.getState().activeBranchId;
    if (branchId) {
        config.headers = config.headers ?? {};
        // Send the sentinel as-is; the server distinguishes combined from a real branch id.
        config.headers["x-active-branch"] = branchId;
    }
    return config;
});

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

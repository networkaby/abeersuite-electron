import { create } from "zustand";
import axios from "axios";
import type { PortalAccountOption } from "@/shared/lib/auth/portalAccountContext";
import type { PortalProfile } from "@/shared/lib/portal/portalProfileTypes";

export type { PortalAccountOption };

/**
 * The signed-in customer's profile + which account (personal / a linked
 * company) the portal is currently using. Loaded ONCE from /api/portal/me and
 * kept here so the header chip, My Profile and checkout all read the same copy
 * — every mutation route returns the fresh profile, which lands via `setProfile`.
 *
 * `options` / `activeAccountId` / `loading` are the fields checkout and the cart
 * already read; they are derived from the profile.
 */
type PortalAccountStore = {
    profile: PortalProfile | null;
    options: PortalAccountOption[];
    activeAccountId: number | null;
    loading: boolean;
    /** True once a load has finished (even a 401 — a guest simply has no profile). */
    loaded: boolean;
    setProfile: (profile: PortalProfile) => void;
    setLoading: (loading: boolean) => void;
    /** Fetch the profile unless already loaded; `force` re-reads. */
    load: (force?: boolean) => Promise<void>;
    /** Switch the account in use — optimistic, rolled back on failure. */
    switchAccount: (accountId: number) => Promise<void>;
    clear: () => void;
};

let inflight: Promise<void> | null = null;

export const usePortalAccountStore = create<PortalAccountStore>((set, get) => ({
    profile: null,
    options: [],
    activeAccountId: null,
    loading: false,
    loaded: false,

    setProfile: (profile) =>
        set({ profile, options: profile.profiles, activeAccountId: profile.activeAccountId, loaded: true }),
    setLoading: (loading) => set({ loading }),

    load: async (force = false) => {
        if (!force && (get().loaded || inflight)) return inflight ?? undefined;
        set({ loading: true });
        inflight = axios
            .get<PortalProfile>("/api/portal/me")
            .then((res) => get().setProfile(res.data))
            .catch((error) => {
                // 401/403 just means the visitor is not signed in to the customer
                // portal — not an error. Only genuine failures are worth surfacing,
                // and the caller decides how.
                const status = axios.isAxiosError(error) ? error.response?.status : undefined;
                if (status !== 401 && status !== 403) throw error;
                set({ profile: null, options: [], activeAccountId: null, loaded: true });
            })
            .finally(() => {
                set({ loading: false });
                inflight = null;
            });
        return inflight;
    },

    switchAccount: async (accountId) => {
        const before = get();
        if (!before.profile || accountId === before.activeAccountId) return;
        set({ activeAccountId: accountId, profile: { ...before.profile, activeAccountId: accountId }, loading: true });
        try {
            await axios.patch("/api/portal/account-context", { accountId });
        } catch (e) {
            set({ activeAccountId: before.activeAccountId, profile: before.profile });
            throw e;
        } finally {
            set({ loading: false });
        }
    },

    clear: () => set({ profile: null, options: [], activeAccountId: null, loaded: false, loading: false }),
}));

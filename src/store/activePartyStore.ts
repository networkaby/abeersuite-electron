import { create } from "zustand";
import type { PickedParty } from "@/shared/components/PartySearchAndCreate";

/**
 * The party whose profile is open right now (Customers → Persons / Companies).
 *
 * Quick Actions read it so a party-facing voucher (Receipt, Payment, Credit /
 * Debit Note, Sale, Purchase, returns, orders, Estimate) opens with that party
 * already in place. Set by the profile pages when a detail loads, cleared when
 * the profile closes or the page unmounts — anywhere else it is null and every
 * voucher opens blank.
 */
export type ActiveParty = PickedParty;

type ActivePartyStore = {
    party: ActiveParty | null;
    setParty: (party: ActiveParty | null) => void;
};

export const useActivePartyStore = create<ActivePartyStore>((set) => ({
    party: null,
    setParty: (party) => set({ party }),
}));

/**
 * One-time hand-over to a full-page voucher (Sale, Purchase…): the trading form
 * lives on another route, so the party rides sessionStorage for exactly one
 * mount — same pattern as the ⋮ → Duplicate flow. Same-tab only by nature; a
 * right-click "new window" cannot carry it, and that is fine.
 */
const KEY = "voucher:preload-party";

export function stashPreloadParty(party: ActiveParty | null): void {
    if (!party) return;
    try { sessionStorage.setItem(KEY, JSON.stringify(party)); } catch { /* private mode / quota — open blank */ }
}

export function consumePreloadParty(): ActiveParty | null {
    try {
        const raw = sessionStorage.getItem(KEY);
        sessionStorage.removeItem(KEY);
        if (!raw) return null;
        const p = JSON.parse(raw) as ActiveParty;
        return p && typeof p.id === "number" && typeof p.name === "string" ? p : null;
    } catch {
        return null;
    }
}

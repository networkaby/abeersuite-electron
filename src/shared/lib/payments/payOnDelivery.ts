// Pure, isomorphic helpers for the Pay-on-Delivery rail's AREA rule. Client- and
// server-safe (imports only the client-safe delivery-config matchers — no prisma,
// no process.env). The rail itself is a PaymentGateway row with provider
// "pay_on_delivery"; this module governs only WHERE it is offered.
//
// configJson shape:  { area: { mode, states[], pincodePrefixes[] } }
//   mode "except" → offered everywhere EXCEPT the listed states / pincode prefixes
//   mode "only"   → offered ONLY in the listed states / pincode prefixes
// An empty rule (no states, no prefixes) means "no area restriction" → offered
// everywhere, regardless of mode.

import {
    sanitizeExclusions,
    isDestinationExcluded,
} from "@/modules/delivery/lib/deliveryMethodConfig";

export type PodAreaMode = "except" | "only";

export type PodAreaConfig = {
    mode: PodAreaMode;
    states: string[]; // canonical India state names
    pincodePrefixes: string[]; // e.g. "78" (all 78xxxx) or "781301"
};

/** Clean an operator-entered area rule (canonical states + numeric prefixes + mode). */
export function sanitizePodArea(raw: unknown): PodAreaConfig {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const { states, pincodePrefixes } = sanitizeExclusions(r);
    const mode: PodAreaMode = r.mode === "only" ? "only" : "except";
    return { mode, states: states ?? [], pincodePrefixes: pincodePrefixes ?? [] };
}

/** Normalise the whole POD configJson to just its `area` (drops any stray keys). */
export function sanitizePodConfig(raw: Record<string, unknown>): Record<string, unknown> {
    return { area: sanitizePodArea(raw.area) };
}

/**
 * Is Pay on delivery offered to this destination? Availability = active-state is
 * decided by the caller; this answers only the AREA question. An empty rule is
 * "everywhere". "except" excludes matches; "only" keeps just matches.
 */
export function isPayOnDeliveryAvailableForArea(
    area: unknown,
    pincode: string,
    state?: string | null,
): boolean {
    const a = sanitizePodArea(area);
    const hasRule = a.states.length > 0 || a.pincodePrefixes.length > 0;
    if (!hasRule) return true;
    const matches = isDestinationExcluded(
        { states: a.states, pincodePrefixes: a.pincodePrefixes },
        pincode,
        state,
    );
    return a.mode === "only" ? matches : !matches;
}

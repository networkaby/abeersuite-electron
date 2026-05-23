/**
 * GSTIN ↔ state integrity guard. A row that stores GSTIN + state code +
 * state name must never persist a mismatch — the tax routing depends on
 * those three agreeing.
 *
 * GSTIN is the source of truth:
 *   • If gstin is set → gstStateCode is forced to gstin.slice(0, 2).
 *   • If gstin is set AND state (textual name) is non-empty → must equal
 *     the canonical state name for gstin[:2] (case-insensitive). Otherwise
 *     reject with a clear error.
 *   • If gstin is blank → leave the other two alone (they're informational).
 *
 * Pure — no Prisma, no React. Safe to call from API handlers and forms.
 */

import {
    isValidStateCode,
    stateNameForCode,
} from "@/shared/lib/gst/indianStates";

export type GstinStateInput = {
    gstin?:        string | null;
    gstStateCode?: string | null;
    state?:        string | null; // free-form state name (Branch / Organisation only)
};

export type GstinStateNormalised = {
    gstin:        string;
    gstStateCode: string;
    state:        string;
};

export type ValidationOk    = { ok: true;  value: GstinStateNormalised };
export type ValidationError = { ok: false; error: string };

const trim = (v: string | null | undefined) => (v ?? "").trim();

export function normaliseGstinState(input: GstinStateInput): ValidationOk | ValidationError {
    const gstin = trim(input.gstin).toUpperCase();
    const inboundCode = trim(input.gstStateCode);
    const inboundName = trim(input.state);

    // No GSTIN → no GST-driven constraints; leave the other two as the
    // caller sent them (the state-code-only fields stay valid if they're
    // either blank or a known state code).
    if (!gstin) {
        if (inboundCode && !isValidStateCode(inboundCode)) {
            return {
                ok: false,
                error: `Invalid state code "${inboundCode}". Expected a 2-digit GSTIN state code (e.g. "18" for Assam).`,
            };
        }
        return { ok: true, value: { gstin: "", gstStateCode: inboundCode, state: inboundName } };
    }

    // GSTIN present → first 2 chars must be a known state code.
    if (gstin.length < 2) {
        return { ok: false, error: `GSTIN "${gstin}" is too short — first 2 characters must be a state code.` };
    }
    const derivedCode = gstin.slice(0, 2);
    const canonical   = stateNameForCode(derivedCode);
    if (!canonical) {
        return { ok: false, error: `GSTIN starts with "${derivedCode}", which is not a valid GST state code.` };
    }

    // gstStateCode is force-aligned with GSTIN. Reject only if the caller
    // sent a non-empty value that explicitly disagrees — silent override
    // of empty/correct values is fine.
    if (inboundCode && inboundCode !== derivedCode) {
        return {
            ok: false,
            error: `gstStateCode "${inboundCode}" does not match GSTIN state code "${derivedCode}" (${canonical}). Remove the override or fix the GSTIN.`,
        };
    }

    // state (name) is also cross-checked when the caller sent one.
    if (inboundName && inboundName.toLowerCase() !== canonical.toLowerCase()) {
        return {
            ok: false,
            error: `State "${inboundName}" does not match the GSTIN state ("${derivedCode}" → ${canonical}). Either fix the state or correct the GSTIN.`,
        };
    }

    return {
        ok: true,
        value: {
            gstin,
            gstStateCode: derivedCode,
            state:        inboundName || canonical,
        },
    };
}

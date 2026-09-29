"use client";

// IFSC → Bank Name + Branch, looked up while staff type (GET /api/ifsc/[code]).
// One hook for every form that takes an IFSC — the party Bank tab, the staff
// salary account and the bank-ledger particulars — shown by <IfscLookupHint>.
//
// Manual override is the rule. The lookup writes Bank Name / Branch only when
// the box is blank or still holds what the lookup itself put there; anything
// staff typed stays, because RBI's list can be out of date. And it writes only
// after the IFSC is typed — opening a saved record never changes it. There the
// answer shows as a hint instead, and `use()` takes it when staff ask.

import { useEffect, useEffectEvent, useRef, useState } from "react";
import axios from "axios";
import { isValidIfsc } from "@/shared/lib/parties/partyBank";

export type IfscDetails = { bank: string; branch: string; address: string; district: string; state: string };

/** The three fields this hook reads and writes — every bank bag in the app has them. */
type IfscBag = { ifsc?: string; bankName?: string; branch?: string };
export type IfscPatch = Partial<Record<"ifsc" | "bankName" | "branch", string>>;

export type IfscLookupState =
    | { status: "idle" }
    | { status: "loading" }
    /** `differs`: Bank Name or Branch on the form is not what RBI's list says. */
    | { status: "found"; details: IfscDetails; differs: boolean }
    | { status: "notFound" }
    | { status: "failed" };

// One answer per code for the whole session, shared by every form — retyping a
// code or reopening a party never asks twice. `null` = not in RBI's list.
const answers = new Map<string, Promise<IfscDetails | null>>();

function lookup(code: string): Promise<IfscDetails | null> {
    let p = answers.get(code);
    if (!p) {
        p = axios.get<{ ok: boolean } & IfscDetails>(`/api/ifsc/${code}`).then(({ data }) =>
            data.ok
                ? { bank: data.bank, branch: data.branch, address: data.address, district: data.district, state: data.state }
                : null);
        // A failure (offline, their service down) is not an answer — forget it so
        // the next attempt asks again.
        p.catch(() => answers.delete(code));
        answers.set(code, p);
    }
    return p;
}

const same = (a: string | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

/** The Bank Name / Branch values the lookup may write. `force` (staff pressed
 *  Use) takes every one; otherwise only a blank box, or one still holding the
 *  lookup's own earlier value, is replaced. */
function fillPatch(d: IfscDetails, bag: IfscBag, ownFill: IfscPatch, force: boolean): IfscPatch {
    const patch: IfscPatch = {};
    for (const [key, value] of [["bankName", d.bank], ["branch", d.branch]] as const) {
        const current = bag[key] ?? "";
        if (!value || same(current, value)) continue;
        if (force || current.trim() === "" || current === ownFill[key]) patch[key] = value;
    }
    return patch;
}

export function useIfscLookup(bag: IfscBag, apply: (patch: IfscPatch) => void) {
    const code = (bag.ifsc ?? "").trim().toUpperCase();
    const complete = code !== "" && isValidIfsc(code);
    const [answer, setAnswer] = useState<{ code: string; details: IfscDetails | null | "failed" } | null>(null);

    // Set by typeIfsc(): the next answer may fill. Never set by a saved value.
    const armed = useRef(false);
    // What the lookup last wrote itself — the values it may still replace.
    const ownFill = useRef<IfscPatch>({});

    const write = (d: IfscDetails, force: boolean) => {
        const patch = fillPatch(d, bag, ownFill.current, force);
        if (Object.keys(patch).length === 0) return;
        ownFill.current = { ...ownFill.current, ...patch };
        apply(patch);
    };
    // An Effect Event, so an answer that lands after more typing still compares
    // against the form as it is now, not as it was when the lookup started.
    const onAnswer = useEffectEvent((details: IfscDetails | null) => {
        if (details && armed.current) write(details, false);
        armed.current = false;
    });

    useEffect(() => {
        if (!complete) return;
        let live = true;
        lookup(code).then(
            (details) => {
                if (!live) return;
                setAnswer({ code, details });
                onAnswer(details);
            },
            () => { if (live) setAnswer({ code, details: "failed" }); },
        );
        return () => { live = false; };
    }, [code, complete]);

    let state: IfscLookupState;
    if (!complete) state = { status: "idle" };
    else if (answer?.code !== code) state = { status: "loading" };
    else if (answer.details === "failed") state = { status: "failed" };
    else if (answer.details === null) state = { status: "notFound" };
    else {
        const d = answer.details;
        const differs = (!!d.bank && !same(bag.bankName, d.bank)) || (!!d.branch && !same(bag.branch, d.branch));
        state = { status: "found", details: d, differs };
    }

    return {
        state,
        /** The IFSC box's onChange: upper-cases the value and lets the answer fill. */
        typeIfsc: (value: string) => {
            armed.current = true;
            apply({ ifsc: value.toUpperCase() });
        },
        /** Take Bank Name and Branch from RBI's list, over whatever is typed. */
        use: () => { if (state.status === "found") write(state.details, true); },
    };
}

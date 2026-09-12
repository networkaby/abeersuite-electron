"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api/extractApiError";

/** What the caller should paint next to the field right now. */
export type FieldSaveState = "idle" | "saving" | "saved" | "error";

/**
 * Pattern D — "values that save on blur, and never say so".
 *
 * Margin, MRP, service price, group name and unit fields all write when focus
 * leaves the box. Success was silent, so nobody could tell whether it landed.
 * Failure toasted and then left the rejected number sitting on screen looking
 * saved — and these are the numbers the till charges by.
 *
 * This hook makes the three rules of a blur-save explicit:
 *
 *   1. Do not write when nothing changed. A tab-through is not an edit.
 *   2. Say "saved", briefly, where the user is looking — not only in a toast at
 *      the other end of the screen.
 *   3. On failure, put the ORIGINAL value back. Leaving the rejected text in the
 *      box is what makes people believe a bad price was accepted.
 *
 * Usage:
 *
 *     const { save, stateOf } = useFieldSave();
 *
 *     <Input
 *       defaultValue={row.margin}
 *       onBlur={(e) => save({
 *         key: `${row.id}:margin`,
 *         original: String(row.margin),
 *         next: e.target.value,
 *         write: (v) => axios.patch(`/api/products/${row.id}`, { margin: Number(v) }),
 *         revert: (v) => { e.target.value = v; },
 *         label: "Margin",
 *       })}
 *     />
 *     <FieldSaveMark state={stateOf(`${row.id}:margin`)} />
 */
export function useFieldSave(opts: { successToast?: boolean } = {}): {
    save: (args: {
        /** Stable id for this one field, e.g. `${rowId}:margin`. */
        key: string;
        /** The value as it was before the user touched it. */
        original: string;
        /** The value now in the box. */
        next: string;
        /** Performs the write. Reject to signal failure. */
        write: (value: string) => Promise<unknown>;
        /** Puts `original` back in the input after a rejected write. */
        revert?: (original: string) => void;
        /** Field name, used in the failure message. */
        label?: string;
        /** Runs only after a confirmed successful write. */
        onSaved?: (value: string) => void;
    }) => Promise<void>;
    /** Current mark for one field. */
    stateOf: (key: string) => FieldSaveState;
    /** True while any field on the screen is mid-write. */
    busy: boolean;
} {
    const [states, setStates] = useState<Record<string, FieldSaveState>>({});
    const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const mark = useCallback((key: string, state: FieldSaveState, clearAfter?: number) => {
        setStates((prev) => ({ ...prev, [key]: state }));
        clearTimeout(timers.current[key]);
        if (clearAfter) {
            timers.current[key] = setTimeout(() => {
                setStates((prev) => ({ ...prev, [key]: "idle" }));
            }, clearAfter);
        }
    }, []);

    const save = useCallback(
        async (args: {
            key: string;
            original: string;
            next: string;
            write: (value: string) => Promise<unknown>;
            revert?: (original: string) => void;
            label?: string;
            onSaved?: (value: string) => void;
        }) => {
            // Rule 1 — a tab-through is not an edit.
            if (args.next === args.original) return;

            mark(args.key, "saving");
            try {
                await args.write(args.next);
                // Rule 2 — visible, where they are looking, then out of the way.
                mark(args.key, "saved", 2000);
                if (opts.successToast) toast.success(`${args.label ?? "Change"} saved`);
                args.onSaved?.(args.next);
            } catch (e) {
                mark(args.key, "error", 4000);
                // Rule 3 — the rejected value must not stay on screen looking saved.
                args.revert?.(args.original);
                toast.error(
                    extractApiError(e, `Could not save ${args.label ?? "this change"}. The previous value is back.`),
                );
            }
        },
        [mark, opts.successToast],
    );

    const stateOf = useCallback((key: string): FieldSaveState => states[key] ?? "idle", [states]);
    const busy = Object.values(states).some((s) => s === "saving");

    return { save, stateOf, busy };
}

"use client";

import { Check, Loader2, AlertCircle } from "lucide-react";
import type { FieldSaveState } from "@/shared/hooks/useFieldSave";
import { cn } from "@/shared/lib/format/utils";

/**
 * The visible half of Pattern D — the mark that sits beside a field that saves
 * on blur, so the user can see the write land.
 *
 * Holds its own width whatever the state, so a table column does not jump as the
 * tick appears and fades.
 */
export function FieldSaveMark({ state, className }: { state: FieldSaveState; className?: string }) {
    return (
        <span
            className={cn("inline-flex w-4 shrink-0 items-center justify-center", className)}
            aria-live="polite"
        >
            {state === "saving" ? (
                <>
                    <Loader2 size={13} className="animate-spin text-muted-foreground" aria-hidden="true" />
                    <span className="sr-only">Saving</span>
                </>
            ) : state === "saved" ? (
                <>
                    <Check size={13} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    <span className="sr-only">Saved</span>
                </>
            ) : state === "error" ? (
                <>
                    <AlertCircle size={13} className="text-destructive" aria-hidden="true" />
                    <span className="sr-only">Not saved — previous value restored</span>
                </>
            ) : null}
        </span>
    );
}

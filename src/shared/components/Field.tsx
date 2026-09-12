"use client";

import { useId } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/shared/lib/format/utils";

/**
 * Pattern E, second half — the labels that were never attached to anything.
 *
 * Across the settings area there were 150 `<Label>` elements against 15 uses of
 * `htmlFor`, and the shared BI filter bar pushed the same gap onto seventeen
 * reports at once. The labels were visible, so nobody noticed: but clicking one
 * did not focus its box, and a screen reader read an unnamed input.
 *
 * `Field` makes that impossible to get wrong — it mints the id itself and hands it
 * to the child, so there is no pair of strings left to drift apart:
 *
 *     <Field label="From">
 *       {(id) => <TallyDateInput id={id} value={from} onValueChange={setFrom} />}
 *     </Field>
 *
 * For a control that cannot take an id (some third-party widgets), pass the label
 * through `aria-label` instead — `Field` is not the only correct answer, just the
 * one that should be reached for first.
 */
export function Field({
    label,
    hint,
    error,
    required,
    className,
    labelClassName,
    children,
}: {
    label: string;
    /** Quiet helper text under the control. */
    hint?: string;
    /** Validation message. Replaces the hint and is announced. */
    error?: string | null;
    required?: boolean;
    className?: string;
    labelClassName?: string;
    children: (id: string) => React.ReactNode;
}) {
    const id = useId();
    const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

    return (
        <div className={cn("space-y-1", className)}>
            <Label htmlFor={id} className={labelClassName}>
                {label}
                {required ? (
                    <span className="ml-0.5 text-destructive" aria-hidden="true">
                        *
                    </span>
                ) : null}
            </Label>

            {/* The child gets both the id and, when there is one, the message that
                describes it — so the announcement carries the error, not just the name. */}
            <div aria-describedby={describedBy}>{children(id)}</div>

            {error ? (
                <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
                    {error}
                </p>
            ) : hint ? (
                <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                    {hint}
                </p>
            ) : null}
        </div>
    );
}

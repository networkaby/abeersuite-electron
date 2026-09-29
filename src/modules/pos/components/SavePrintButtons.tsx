"use client";

// ── SavePrintButtons ─────────────────────────────────────────────────────────
// The counter's one save rule: every voucher saved at the POS offers "<Save>"
// and "<Save> + Print" side by side, and Ctrl/Cmd+Enter is always the print
// one. Plain Enter saves WITHOUT printing only where the dialog binds it — a
// dialog whose Enter already means something else (a +/- stepper, a notes box,
// a denomination grid) passes `enterSaves={false}` and shows no ↵ hint. The
// print itself stays with the caller (thermal first, the 80mm page as the
// fallback — printVoucherThermal).

import type React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/lib/format/utils";

/** Enter → onSave(false), Ctrl/Cmd+Enter → onSave(true). An Enter a field
 *  inside already handled (preventDefault) is left alone, so a field-level and
 *  a dialog-level handler never both fire; preventing the default also stops a
 *  focused button from clicking itself on the same key. A held key's repeats
 *  never save — the Ctrl+Enter that opened a checkout must not also confirm it. */
export function savePrintKey(
    e: React.KeyboardEvent,
    onSave: (print: boolean) => void,
    opts: { enterSaves?: boolean; disabled?: boolean } = {},
): void {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.isDefaultPrevented()) return;
    const print = e.ctrlKey || e.metaKey;
    if (!print && opts.enterSaves === false) return;
    e.preventDefault();
    if (!e.repeat && !opts.disabled) onSave(print);
}

export function SavePrintButtons({
    label, printLabel, onSave,
    disabled = false, submitting = false, enterSaves = true,
    icon, title, printClassName, className, size = "default",
}: {
    label: string;
    printLabel: string;
    onSave: (print: boolean) => void;
    disabled?: boolean;
    submitting?: boolean;
    /** Show the ↵ hint — only when the dialog actually binds plain Enter. */
    enterSaves?: boolean;
    icon?: React.ReactNode;
    title?: string;
    /** Colour override for the print (filled) button, e.g. a red Return. */
    printClassName?: string;
    className?: string;
    size?: "default" | "lg";
}) {
    const lead = submitting ? <Loader2 size={14} className="animate-spin" /> : icon;
    const off = disabled || submitting;
    return (
        <div className={cn("grid grid-cols-2 gap-2", className)}>
            <Button onClick={() => onSave(false)} disabled={off} size={size} variant="outline" title={title}>
                {lead} {submitting ? "Saving…" : label}
                {enterSaves && <span className="ml-2 rounded border border-border px-1.5 py-px text-[10px] opacity-80">↵</span>}
            </Button>
            <Button onClick={() => onSave(true)} disabled={off} size={size} title={title} className={printClassName}>
                {lead} {submitting ? "Saving…" : printLabel}
                <span className="ml-2 rounded border border-primary-foreground/30 px-1.5 py-px text-[10px] opacity-80">Ctrl ↵</span>
            </Button>
        </div>
    );
}

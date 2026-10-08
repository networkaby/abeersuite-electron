"use client";

import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/shared/lib/format/utils";
import { loadStaff, type Staff } from "./StaffPickerDialog";

/**
 * The staff a text @mentions — by full name, as MentionTextarea inserts it.
 * A text with any mention is a STAFF NOTE, never sent to the customer.
 */
export async function mentionedStaff(text: string): Promise<Staff[]> {
    if (!text.includes("@")) return [];
    const staff = await loadStaff();
    const lower = text.toLowerCase();
    return staff.filter((s) => lower.includes(`@${s.name.toLowerCase()}`));
}

/** The "@word" being typed at the caret, if any. */
function mentionQuery(text: string, caret: number): { start: number; q: string } | null {
    const m = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
    return m ? { start: caret - m[2].length - 1, q: m[2].toLowerCase() } : null;
}

/**
 * A reply box that offers staff names after "@". Enter / Tab picks the first
 * suggestion while the list is open; otherwise keys pass to `onKeyDown`.
 */
export default function MentionTextarea({ value, onChange, onKeyDown, className, ...rest }: {
    value: string;
    onChange: (text: string) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
}) {
    const ref = useRef<HTMLTextAreaElement>(null);
    const [staff, setStaff] = useState<Staff[]>([]);
    const [query, setQuery] = useState<{ start: number; q: string } | null>(null);

    useEffect(() => {
        if (query && !staff.length) loadStaff().then(setStaff).catch(() => {});
    }, [query, staff.length]);

    const hits = query ? staff.filter((s) => s.name.toLowerCase().includes(query.q)).slice(0, 6) : [];

    const pickStaff = (s: Staff) => {
        if (!query) return;
        const caret = ref.current?.selectionStart ?? value.length;
        const next = `${value.slice(0, query.start)}@${s.name} ${value.slice(caret)}`;
        onChange(next);
        setQuery(null);
        const pos = query.start + s.name.length + 2;
        requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(pos, pos); });
    };

    return (
        <div className="relative flex-1">
            {hits.length > 0 && (
                <div className="absolute bottom-full left-0 z-10 mb-1 w-56 rounded-md border bg-background py-1 shadow-lg">
                    <p className="px-2 pb-1 text-[11px] text-muted-foreground">Mention = staff note, not sent to the customer</p>
                    {hits.map((s, i) => (
                        <button
                            key={s.id}
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); pickStaff(s); }}
                            className={cn("block w-full px-2 py-1 text-left text-sm hover:bg-muted", i === 0 && "bg-muted/60")}
                        >
                            @{s.name}
                        </button>
                    ))}
                </div>
            )}
            <Textarea
                ref={ref}
                value={value}
                rows={1}
                className={cn("min-h-9 resize-none", className)}
                onChange={(e) => {
                    onChange(e.target.value);
                    setQuery(mentionQuery(e.target.value, e.target.selectionStart));
                }}
                onBlur={() => setQuery(null)}
                onKeyDown={(e) => {
                    if (hits.length && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); pickStaff(hits[0]); return; }
                    if (hits.length && e.key === "Escape") { e.preventDefault(); setQuery(null); return; }
                    onKeyDown?.(e);
                }}
                {...rest}
            />
        </div>
    );
}

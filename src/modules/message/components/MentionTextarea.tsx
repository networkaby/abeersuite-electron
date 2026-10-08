"use client";

import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/shared/lib/format/utils";
import { loadDirectory, type Staff, type StaffGroup } from "./StaffPickerDialog";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** "@Name" as a whole mention — so "@All" does not fire inside "@Allen". */
const mentions = (text: string, name: string) =>
    new RegExp(`(^|\\s)@${escapeRe(name)}(?=$|[\\s.,!?;:])`, "i").test(text);

/**
 * Who a text @mentions — people by full name, and @All / @Department /
 * @Branch expanded to their members. A text with any mention is a STAFF
 * NOTE, never sent to the customer.
 */
export async function mentionedStaff(text: string): Promise<{ people: Staff[]; groups: StaffGroup[] }> {
    if (!text.includes("@")) return { people: [], groups: [] };
    const { staff, groups } = await loadDirectory();
    const hitGroups = groups.filter((g) => mentions(text, g.name));
    const ids = new Set(staff.filter((s) => mentions(text, s.name)).map((s) => s.id));
    for (const g of hitGroups) for (const id of g.memberIds) ids.add(id);
    return { people: staff.filter((s) => ids.has(s.id)), groups: hitGroups };
}

/**
 * What a draft's mentions mean for the sender `me`: null = no mention (a
 * normal reply); otherwise the colleagues the note goes to (never `me`) and a
 * label for the toast — "Service (4 people)" for a group. `ids` empty = the
 * mention named only the sender, or a group with nobody else in it.
 */
export async function mentionTargets(text: string, me: number | null): Promise<{ ids: number[]; label: string } | null> {
    const { people, groups } = await mentionedStaff(text);
    if (!people.length && !groups.length) return null;
    const others = people.filter((m) => m.id !== me);
    const label = groups.length
        ? `${groups.map((g) => g.name).join(", ")} (${others.length} ${others.length === 1 ? "person" : "people"})`
        : others.map((m) => m.name).join(", ");
    return { ids: others.map((m) => m.id), label };
}

type Suggestion ={ key: string; name: string; tag: string };
const GROUP_TAG = { all: "All", department: "Department", branch: "Branch" } as const;

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
    const [options, setOptions] = useState<Suggestion[]>([]);
    const [query, setQuery] = useState<{ start: number; q: string } | null>(null);

    useEffect(() => {
        if (!query || options.length) return;
        loadDirectory().then(({ staff, groups }) => setOptions([
            // Groups first; a group nobody in it could answer is not offered.
            ...groups.filter((g) => g.memberIds.length).map((g) => ({ key: `${g.kind}:${g.id}`, name: g.name, tag: GROUP_TAG[g.kind] })),
            ...staff.map((s) => ({ key: `u:${s.id}`, name: s.name, tag: s.position || "Staff" })),
        ])).catch(() => {});
    }, [query, options.length]);

    const hits = query ? options.filter((s) => s.name.toLowerCase().includes(query.q)).slice(0, 8) : [];

    const pickStaff = (s: Suggestion) => {
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
                <div className="absolute bottom-full left-0 z-10 mb-1 w-72 rounded-md border bg-background py-1 shadow-lg">
                    <p className="px-2 pb-1 text-[11px] text-muted-foreground">Mention = staff note, not sent to the customer</p>
                    {hits.map((s, i) => (
                        <button
                            key={s.key}
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); pickStaff(s); }}
                            className={cn("flex w-full items-baseline gap-2 px-2 py-1 text-left text-sm hover:bg-muted", i === 0 && "bg-muted/60")}
                        >
                            <span className="truncate">@{s.name}</span>
                            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{s.tag}</span>
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

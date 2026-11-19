"use client";

import { formatDate } from "@/shared/lib/format/formatDate";

/** One place for every AI note on a product (owner, 2026-11-12): the Attention reason,
 *  Claude's review notes (kept, dated, after publishing) and the latest copy run's notes. */
export type AiNotesBoxProps = {
    attention?: { text: string; by?: string | null; at?: string | Date | null; parked: boolean } | null;
    review?: { notes: string[]; at?: string | null; kept?: boolean } | null;
    copy?: { source: string; notes: string[]; flags: string[] } | null;
};

const when = (at?: string | Date | null) => (at ? ` · ${formatDate(at)}` : "");

/** Product prep tags each note with its part (owner, 2026-11-19); shown grouped, Part 1 → 5. */
const PART_TITLES: Record<number, string> = {
    1: "Part 1 · Clean seed", 2: "Part 2 · Search", 3: "Part 3 · Copy written", 4: "Part 4 · Check", 5: "Part 5 · Photos",
};
const TAG = /^Part (\d) · /;
function grouped(lines: string[]) {
    const lastRun = lines.find((n) => n.startsWith("Last run: "));
    const groups = new Map<number, string[]>();
    for (const n of lines) {
        // The old "Part 3 done" signs say nothing the headings do not.
        if (n === lastRun || /^Part \d done$/.test(n)) continue;
        const m = TAG.exec(n);
        const key = m ? Number(m[1]) : 0;
        groups.set(key, [...(groups.get(key) ?? []), m ? n.slice(m[0].length) : n]);
    }
    return { lastRun, groups: [...groups.entries()].sort(([a], [b]) => a - b) };
}

function NoteList({ lines, hideRun }: { lines: string[]; hideRun?: boolean }) {
    const { lastRun, groups } = grouped(lines);
    const titled = groups.some(([k]) => k > 0);
    return (
        <div className="space-y-1">
            {lastRun && !hideRun && <p className="opacity-80">{lastRun}</p>}
            {groups.map(([k, items]) => (
                <div key={k}>
                    {titled && <p className="mt-1 text-[11px] font-medium uppercase opacity-70">{PART_TITLES[k] ?? "Earlier"}</p>}
                    <ul className="ml-4 list-disc space-y-0.5">{items.map((n) => <li key={n}>{n}</li>)}</ul>
                </div>
            ))}
        </div>
    );
}

export function AiNotesBox({ attention, review, copy }: AiNotesBoxProps) {
    const hasCopy = !!copy && (copy.notes.length > 0 || copy.flags.length > 0);
    // The Attention reason carries its own Last run line — shown once.
    const runShown = !!attention?.text.includes("Last run: ");
    if (!attention && !review?.notes.length && !hasCopy) return null;
    return (
        <div className="space-y-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
            <p className="text-sm font-medium">AI notes</p>
            {attention && (
                <div className="rounded border border-orange-200 bg-orange-50 p-2 text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200">
                    <p className="font-medium">
                        {attention.parked ? "Parked in Attention" : "Was parked in Attention"}
                        {attention.by ? ` by ${attention.by}` : ""}{when(attention.at)}
                    </p>
                    <p className="mt-1 whitespace-pre-line">{attention.text}</p>
                    <p className="mt-1 opacity-80">
                        {attention.parked
                            ? "Check it, then Save as draft to carry on working, or Save as ready if it is done."
                            : "Shown until Save as ready."}
                    </p>
                </div>
            )}
            {review && review.notes.length > 0 && (
                <div>
                    <p className="font-medium">{review.kept ? "Last AI review" : "Claude review"}{when(review.at)}</p>
                    <NoteList lines={review.notes} hideRun={runShown} />
                    <p className="mt-1 opacity-80">
                        {review.kept
                            ? "Kept after publishing — improve when you can. The next AI review replaces them."
                            : "Fix what applies, then Save as ready — or Discard draft to drop them."}
                    </p>
                </div>
            )}
            {hasCopy && (
                <div>
                    <p className="font-medium">{copy!.source}</p>
                    {copy!.flags.length > 0 && (
                        <ul className="ml-4 list-disc text-orange-800 dark:text-orange-300">{copy!.flags.map((f) => <li key={f}>{f}</li>)}</ul>
                    )}
                    <NoteList lines={copy!.notes} hideRun={runShown} />
                </div>
            )}
        </div>
    );
}

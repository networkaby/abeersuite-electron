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

export function AiNotesBox({ attention, review, copy }: AiNotesBoxProps) {
    const hasCopy = !!copy && (copy.notes.length > 0 || copy.flags.length > 0);
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
                    <ul className="ml-4 list-disc space-y-0.5">{review.notes.map((n) => <li key={n}>{n}</li>)}</ul>
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
                    <ul className="ml-4 list-disc space-y-0.5">{copy!.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                </div>
            )}
        </div>
    );
}

"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { formatDate } from "@/shared/lib/format/formatDate";
import { extractApiError } from "@/shared/lib/api";
import type { PrepProblem, PrepRun, StaffNote } from "@/modules/ecommerce/lib/productAdmin";

/** One place for every AI note on a product (owner, 2026-11-12): the Attention reason,
 *  Claude's review notes (kept, dated, after publishing) and the latest copy run's notes. */
export type AiNotesBoxProps = {
    attention?: { text: string; by?: string | null; at?: string | Date | null; parked: boolean } | null;
    review?: { notes: string[]; at?: string | null; kept?: boolean } | null;
    copy?: { source: string; notes: string[]; flags: string[] } | null;
    /** Product prep's runs and open problems (owner, 2026-11-20) — when there are any, the box shows only these. */
    prep?: { productId: number; runs: PrepRun[]; problems: PrepProblem[]; staffNotes?: StaffNote[]; onChanged: () => void } | null;
};

const STAGE: Record<string, string> = { UNPUBLISHED: "Unpublished", WAITING: "Waiting", DRAFT: "Draft", ATTENTION: "Attention", READY: "Ready", PUBLISHED: "Published" };

/** Only what must be solved, and which skill ran when (owner, 2026-11-20). */
/**
 * Staff / owner instructions for the next AI run (owner, 2026-11-20): "add one
 * more photo", "check xyz and do abcd". The run reads them and reports back.
 */
function StaffNotes({ productId, staffNotes = [], onChanged }: NonNullable<AiNotesBoxProps["prep"]>) {
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const send = async (body: object) => {
        setBusy(true);
        try {
            await axios.post(`/api/ecommerce/products/${productId}/staff-notes`, body);
            onChanged();
            return true;
        } catch (e) {
            toast.error(extractApiError(e, "Could not save the note"));
            return false;
        } finally {
            setBusy(false);
        }
    };
    const open = staffNotes.filter((n) => !n.doneAt);
    const done = staffNotes.filter((n) => n.doneAt).slice(-3);
    return (
        <div>
            <p className="font-medium">Notes for the AI</p>
            {(open.length > 0 || done.length > 0) && (
                <ul className="mt-1 space-y-1">
                    {[...open, ...done].map((n) => (
                        <li key={n.id} className="flex items-start justify-between gap-3">
                            <span className={n.doneAt ? "text-muted-foreground line-through decoration-1" : "text-blue-700 dark:text-blue-400"}>
                                <span className={`mr-1.5 inline-block size-2 rounded-full ${n.doneAt ? "bg-muted-foreground/50" : "bg-blue-600"}`} />
                                {n.text} <span className="text-muted-foreground no-underline">— {n.by} · {formatDate(n.at)}</span>
                                {n.reply && <span className="block pl-3.5 text-muted-foreground no-underline">AI: {n.reply}</span>}
                            </span>
                            <label className="flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap text-muted-foreground">
                                <input type="checkbox" checked={!!n.doneAt} disabled={busy} onChange={(e) => void send({ noteId: n.id, done: e.target.checked })} />
                                done
                            </label>
                        </li>
                    ))}
                </ul>
            )}
            <form
                className="mt-1.5 flex gap-2"
                onSubmit={async (e) => {
                    e.preventDefault();
                    if (text.trim() && (await send({ add: text.trim() }))) setText("");
                }}
            >
                <input
                    type="text"
                    value={text}
                    maxLength={500}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="e.g. add one more photo of the back"
                    className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs"
                />
                <button type="submit" disabled={busy || !text.trim()} className="h-7 rounded border border-border px-2 text-xs disabled:opacity-50">Add note</button>
            </form>
        </div>
    );
}

function PrepNotes(props: NonNullable<AiNotesBoxProps["prep"]>) {
    const { productId, runs, problems, onChanged } = props;
    const [busy, setBusy] = useState<string | null>(null);
    const tick = async (p: PrepProblem, aside: boolean) => {
        setBusy(p.text);
        try {
            await axios.post(`/api/ecommerce/products/${productId}/problems`, { text: p.text, aside });
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Could not save the tick"));
        } finally {
            setBusy(null);
        }
    };
    return (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
            <p className="text-sm font-medium">AI notes</p>
            {runs.length > 0 && (
                <ul className="space-y-0.5 text-muted-foreground">
                    {runs.map((r) => (
                        <li key={r.at}>{r.skill} part {r.part} · {formatDate(r.at)} · {STAGE[r.from] ?? r.from} → {STAGE[r.to] ?? r.to}</li>
                    ))}
                </ul>
            )}
            {problems.length > 0 && (
                <div>
                    <p className="font-medium">Open problems</p>
                    <ol className="mt-1 space-y-1">
                        {problems.map((p, i) => {
                            const aside = !!p.asideAt;
                            const tone = aside ? "text-muted-foreground line-through decoration-1" : p.level === "stop" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400";
                            return (
                                <li key={p.text} className="flex items-start justify-between gap-3">
                                    <span className={tone}>
                                        <span className={`mr-1.5 inline-block size-2 rounded-full ${aside ? "bg-muted-foreground/50" : p.level === "stop" ? "bg-red-600" : "bg-amber-500"}`} />
                                        {i + 1}. {p.text}
                                        {aside && <span className="ml-1 no-underline">(set aside{p.asideBy ? ` by ${p.asideBy}` : ""}{p.asideAt ? ` · ${formatDate(p.asideAt)}` : ""})</span>}
                                    </span>
                                    <label className="flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap text-muted-foreground">
                                        <input type="checkbox" checked={aside} disabled={busy === p.text} onChange={(e) => void tick(p, e.target.checked)} />
                                        can&apos;t fix now
                                    </label>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            )}
            <StaffNotes {...props} />
        </div>
    );
}

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

export function AiNotesBox({ attention, review, copy, prep }: AiNotesBoxProps) {
    // With a product (not a new one) the prep box always shows, so staff can leave the first note.
    if (prep && (prep.runs.length || prep.problems.length || prep.staffNotes?.length || (!attention && !review?.notes.length && !copy?.notes.length && !copy?.flags.length))) return <PrepNotes {...prep} />;
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
            {prep && <StaffNotes {...prep} />}
        </div>
    );
}

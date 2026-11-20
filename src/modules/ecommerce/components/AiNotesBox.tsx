"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { formatDate } from "@/shared/lib/format/formatDate";
import { extractApiError } from "@/shared/lib/api";
import { problemText, splitAttention, type ClosedProblem, type PrepProblem, type PrepRun, type StaffNote } from "@/modules/ecommerce/lib/productAdmin";

/** One place for every AI note on a product (owner, 2026-11-12): the Attention reason,
 *  Claude's review notes (kept, dated, after publishing) and the latest copy run's notes. */
export type AiNotesBoxProps = {
    attention?: { text: string; by?: string | null; at?: string | Date | null; parked: boolean } | null;
    review?: { notes: string[]; at?: string | null; kept?: boolean } | null;
    copy?: { source: string; notes: string[]; flags: string[] } | null;
    /** Product prep's runs and open problems (owner, 2026-11-20) — when there are any, the box shows only these. */
    prep?: { productId: number; runs: PrepRun[]; problems: PrepProblem[]; staffNote?: StaffNote | null; closed?: ClosedProblem[]; onChanged: () => void } | null;
};

const STAGE: Record<string, string> = { UNPUBLISHED: "Unpublished", WAITING: "Start", DRAFT: "Draft", ATTENTION: "Attention", READY: "Ready", PUBLISHED: "Published" };

/** One short history line (owner, 2026-11-20: "simple"): when, which part, stage, found / fixed. */
function runLine(r: PrepRun) {
    const counts = [r.found ? `found ${r.found}` : "", r.fixed ? `fixed ${r.fixed}` : ""].filter(Boolean).join(", ");
    return `${r.skill} part ${r.part} · ${formatDate(r.at)} · ${STAGE[r.from] ?? r.from} → ${STAGE[r.to] ?? r.to}${counts ? ` · ${counts}` : ""}`;
}

/**
 * An old "Last run: Part 5 · 20 Nov 2026, 11:27 am · photos done → Draft" line in
 * the same shape as a run record (owner, 2026-11-20: one format). The stage it
 * came from was never saved, so only where it went is shown.
 */
function oldRunLine(line: string) {
    const m = /^Last run: Part (\d) · (\d{1,2} \w{3} \d{4})[^·]*·.*?(?:→\s*(\w+))?\s*$/.exec(line);
    if (!m) return line.slice("Last run: ".length);
    const skill = m[1] === "4" ? "product-recheck" : "product-prep";
    return `${skill} part ${m[1]} · ${m[2]}${m[3] ? ` · → ${m[3]}` : ""}`;
}

/**
 * The manual note (owner, 2026-11-20): one box staff edit directly, Markdown
 * bullets allowed. Text in {…} is for the AI and joins the open problems; the
 * rest is for people. Add note → Update note; cleared → Remove note.
 */
function ManualNote({ productId, staffNote, onChanged }: NonNullable<AiNotesBoxProps["prep"]>) {
    const saved = staffNote?.text ?? "";
    const [text, setText] = useState(saved);
    const [busy, setBusy] = useState(false);
    const [base, setBase] = useState(saved);
    if (saved !== base) {
        setBase(saved);
        setText(saved);
    }
    const changed = text.trim() !== saved.trim();
    const label = !saved ? "Add note" : text.trim() ? "Update note" : "Remove note";
    const save = async () => {
        setBusy(true);
        try {
            await axios.post(`/api/ecommerce/products/${productId}/staff-notes`, { text });
            onChanged();
        } catch (e) {
            toast.error(extractApiError(e, "Could not save the note"));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div>
            <p className="font-medium">Manual note</p>
            <textarea
                value={text}
                maxLength={4000}
                rows={Math.min(10, Math.max(3, text.split("\n").length + 1))}
                onChange={(e) => setText(e.target.value)}
                placeholder={"- Box is torn on the left, do not show it\n- {Add one more photo of the side ports}"}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs placeholder:text-muted-foreground/40"
            />
            <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                    Text in {"{ }"} goes to the AI as an open problem; the rest is for people.
                    {staffNote && ` ${staffNote.by} · ${formatDate(staffNote.at)}`}
                </span>
                <button type="button" onClick={() => void save()} disabled={busy || !changed} className="h-7 shrink-0 rounded border border-border px-2 text-xs disabled:opacity-50">{label}</button>
            </div>
        </div>
    );
}

/**
 * The latest run, the one shared open list, the manual note and the short history
 * (owner, 2026-11-20). A product run before run records existed keeps only what
 * fits: its old "Last run" lines join the history, its Attention lines the open
 * list; the old free-text notes are not shown.
 */
function PrepNotes(props: NonNullable<AiNotesBoxProps["prep"]> & { oldRuns?: string[]; oldProblems?: PrepProblem[] }) {
    const { productId, runs, onChanged, oldRuns = [] } = props;
    const problems = props.problems.length ? props.problems : (props.oldProblems ?? []);
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
    // One line per part — its most recent run, newest first (owner, 2026-11-20).
    const partOf = (label: string) => label.split(/ \(| · /)[0];
    const perPart = new Map<string, string>();
    for (const r of [...runs].reverse()) if (!perPart.has(partOf(r.part))) perPart.set(partOf(r.part), runLine(r));
    for (const l of oldRuns) {
        const k = /part (\S+)/.exec(l)?.[1] ?? l;
        if (!perPart.has(k)) perPart.set(k, l);
    }
    const recent = [...perPart.values()];
    // History = the closed problems (owner, 2026-11-20): what left the open list, who closed it, when.
    const closed = [...(props.closed ?? [])].reverse();
    return (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
            <p className="text-sm font-medium">AI notes</p>
            {recent.length ? (
                <ul className="space-y-0.5 text-muted-foreground">{recent.map((l) => <li key={l}>{l}</li>)}</ul>
            ) : (
                <p className="text-muted-foreground">No AI run recorded yet</p>
            )}
            {problems.length > 0 && (
                <div>
                    <p className="font-medium">Open problems</p>
                    <ol className="mt-1 space-y-1">
                        {problems.map((p, i) => {
                            const aside = !!p.asideAt;
                            const staff = p.source === "staff";
                            const tone = aside ? "text-muted-foreground" : staff ? "text-blue-700 dark:text-blue-400" : p.level === "stop" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400";
                            const dot = aside ? "bg-muted-foreground/50" : staff ? "bg-blue-600" : p.level === "stop" ? "bg-red-600" : "bg-amber-500";
                            return (
                                <li key={p.text} className="flex items-start justify-between gap-3">
                                    <span className={tone}>
                                        <span className={`mr-1.5 inline-block size-2 rounded-full ${dot}`} />
                                        {i + 1}. {problemText(p.text)}
                                        <span className="ml-1 text-muted-foreground">
                                            · {staff ? (p.by ?? "staff") : `AI part ${(p.parts ?? [p.part]).join(", ")}`}
                                            {aside && ` · can't fix now${p.asideBy ? ` (${p.asideBy}, ${formatDate(p.asideAt!)})` : ""} — not blocking, stays until fixed`}
                                        </span>
                                    </span>
                                    {p.at && (
                                        <label className="flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap text-muted-foreground">
                                            <input type="checkbox" checked={aside} disabled={busy === p.text} onChange={(e) => void tick(p, e.target.checked)} />
                                            can&apos;t fix now
                                        </label>
                                    )}
                                </li>
                            );
                        })}
                    </ol>
                </div>
            )}
            <ManualNote {...props} />
            {closed.length > 0 && (
                <details>
                    <summary className="cursor-pointer text-muted-foreground">AI history — closed problems ({closed.length})</summary>
                    <ul className="mt-1 space-y-0.5 pl-4 text-muted-foreground">
                        {closed.map((c) => (
                            <li key={`${c.at}-${c.text}`}>
                                <span className="text-green-700 dark:text-green-400">✓</span> {problemText(c.text)}
                                <span className="opacity-80"> · raised by {c.raisedBy} · {c.how === "removed" ? "removed from the note" : "closed"} by {c.by} · {formatDate(c.at)}</span>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
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
    // A saved product always gets the one format (owner, 2026-11-20: "keep what fits, remove others").
    if (prep) {
        const lines = [...(attention?.text.split("\n") ?? []), ...(review?.notes ?? []), ...(copy?.notes ?? [])].map((l) => l.trim());
        const oldRuns = [...new Set(lines.filter((l) => l.startsWith("Last run: ")).map(oldRunLine))];
        const oldProblems: PrepProblem[] = attention?.parked
            ? splitAttention(attention.text).problems.map((x) => ({ text: x.text, level: x.level === "stop" ? "stop" : "fix", part: 0, at: "" }))
            : [];
        return <PrepNotes {...prep} oldRuns={oldRuns} oldProblems={oldProblems} />;
    }
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

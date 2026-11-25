"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { cloudinaryThumb } from "@/shared/lib/cloudinaryImage";
import { formatDate } from "@/shared/lib/format/formatDate";
import { extractApiError } from "@/shared/lib/api";
import { openList, problemText, type ClosedProblem, type PrepProblem, type PrepRun, type StaffNote, type NextAct, type NextStep } from "@/modules/ecommerce/lib/productAdmin";

/** One place for every AI note on a product (owner, 2026-11-12): the Attention reason,
 *  Claude's review notes (kept, dated, after publishing) and the latest copy run's notes. */
export type AiNotesBoxProps = {
    attention?: { text: string; by?: string | null; at?: string | Date | null; parked: boolean } | null;
    review?: { notes: string[]; at?: string | null; kept?: boolean } | null;
    copy?: { notes: string[]; flags: string[] } | null;
    /** Product prep's runs and open problems (owner, 2026-11-20) — when there are any, the box shows only these. */
    prep?: {
        productId: number; runs: PrepRun[]; problems: PrepProblem[]; staffNote?: StaffNote | null; closed?: ClosedProblem[]; onChanged: () => void;
        /** The last line (owner, 2026-11-22): where to go from here; `onAct` makes the move when staff press it. */
        next?: NextStep | null; onAct?: (act: NextAct) => void; acting?: boolean;
        /** Puts a photo an AI run removed back into the gallery. */
        onPutBack?: (url: string) => void; gallery?: string[];
    } | null;
};

const STAGE: Record<string, string> = { UNPUBLISHED: "Unpublished", WAITING: "Start", DRAFT: "Draft", ATTENTION: "Attention", READY: "Ready", PUBLISHED: "Published" };

/** One short history line (owner, 2026-11-20: "simple"): when, which part, stage, found / fixed. */
function runLine(r: PrepRun) {
    const counts = [r.found ? `found ${r.found}` : "", r.fixed ? `fixed ${r.fixed}` : ""].filter(Boolean).join(", ");
    if (r.skill === "staff") return `staff ${r.part} · ${formatDate(r.at)} · ${STAGE[r.from] ?? r.from} → ${STAGE[r.to] ?? r.to}`;
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
function PrepNotes(props: NonNullable<AiNotesBoxProps["prep"]> & { oldRuns?: string[] }) {
    const { productId, runs, problems, onChanged, oldRuns = [] } = props;
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
    // Staff stage moves (owner, 2026-11-22): the latest 3, mixed in by date.
    const perPart = new Map<string, PrepRun>();
    for (const r of [...runs].reverse()) if (r.skill !== "staff" && !perPart.has(partOf(r.part))) perPart.set(partOf(r.part), r);
    const shown = [...perPart.values(), ...runs.filter((r) => r.skill === "staff").slice(-3)].sort((a, b) => b.at.localeCompare(a.at));
    const recent = shown.map(runLine);
    for (const l of oldRuns) {
        const k = /part (\S+)/.exec(l)?.[1] ?? l;
        // "1+2+3" covers an old "part 3" line too.
        if (![...perPart.keys()].some((p) => p.split("+").includes(k))) recent.push(l);
    }
    const removed = [...new Map(runs.flatMap((r) => r.removed ?? []).map((x) => [x.url, x])).values()].filter((x) => !props.gallery?.includes(x.url));
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
                                            · {staff ? (p.by ?? "staff") : !(p.parts ?? [p.part]).some(Boolean) ? "AI / Attention" : `AI part ${(p.parts ?? [p.part]).join(", ")}`}
                                            {aside && ` · temporary pass${p.asideBy ? ` (${p.asideBy}, ${formatDate(p.asideAt!)})` : ""} — not blocking, stays until fixed`}
                                        </span>
                                    </span>
                                    <label className="flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap text-muted-foreground">
                                        <input type="checkbox" checked={aside} disabled={busy === p.text} onChange={(e) => void tick(p, e.target.checked)} />
                                        temporary pass
                                    </label>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            )}
            {removed.length > 0 && props.onPutBack && (
                <details>
                    <summary className="cursor-pointer text-muted-foreground">Photos removed by AI ({removed.length})</summary>
                    <ul className="mt-1 space-y-1">
                        {removed.map((x) => (
                            <li key={x.url} className="flex items-center gap-2">
                                {/* eslint-disable-next-line @next/next/no-img-element -- small Cloudinary thumb */}
                                <img src={cloudinaryThumb(x.url, 96, "square")} alt="" className="size-10 shrink-0 rounded border border-border object-cover" />
                                <span className="flex-1 text-muted-foreground">{x.why}</span>
                                <button type="button" onClick={() => props.onPutBack!(x.url)} className="h-7 shrink-0 rounded border border-border px-2">Put back</button>
                            </li>
                        ))}
                    </ul>
                </details>
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
            {props.next?.text ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md bg-sky-100 px-2.5 py-1.5 text-sky-900 dark:bg-sky-950 dark:text-sky-100">
                    <span className="flex-1"><span className="font-medium">Next:</span> {props.next.text}</span>
                    {props.next.act && props.onAct ? (
                        <button type="button" disabled={props.acting} onClick={() => props.onAct!(props.next!.act!)}
                            className="rounded border border-sky-300 bg-white px-2 py-0.5 text-xs font-medium hover:bg-sky-50 disabled:opacity-50 dark:border-sky-700 dark:bg-sky-900">
                            {props.next.actLabel}
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

export function AiNotesBox({ attention, review, copy, prep }: AiNotesBoxProps) {
    // An unsaved product has no AI run yet.
    if (!prep) return null;
    const lines = [...(attention?.text.split("\n") ?? []), ...(review?.notes ?? []), ...(copy?.notes ?? [])].map((l) => l.trim());
    const oldRuns = [...new Set(lines.filter((l) => l.startsWith("Last run: ")).map(oldRunLine))];
    return <PrepNotes {...prep} oldRuns={oldRuns} problems={openList(prep.problems, attention?.parked ? attention.text : null, copy?.flags ?? [], prep.closed)} />;
}

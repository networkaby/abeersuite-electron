"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { RefreshCw, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PaginationBar } from "@/shared/components/PaginationBar";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { cn } from "@/shared/lib/format/utils";

type Review = {
    id: number;
    platform: string;
    reviewerName: string | null;
    reviewerPhoto: string | null;
    stars: number | null;
    comment: string | null;
    reviewedAt: string;
    replyText: string | null;
    repliedAt: string | null;
    repliedByName: string | null;
    /** An agent's reply waiting for staff (Cowork in Draft mode, or 1–2 stars). */
    draftText: string | null;
    draftByName: string | null;
    draftedAt: string | null;
};
type ListReply = {
    rows: Review[];
    total: number;
    pageSize: number;
    waiting: number;
    drafts: number;
    google: { ready: boolean; lastError: string | null; setupProblem: string | null };
};
type Replied = "" | "no" | "draft" | "yes";

const PLATFORM_LABEL: Record<string, string> = { GOOGLE: "Google" };
const dateText = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function Stars({ n }: { n: number | null }) {
    if (!n) return <span className="text-xs text-muted-foreground">no stars</span>;
    return (
        <span className="inline-flex" aria-label={`${n} of 5 stars`}>
            {[1, 2, 3, 4, 5].map((i) => (
                <Star key={i} className={cn("size-3.5", i <= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
            ))}
        </span>
    );
}

/**
 * CRM → Reviews: public reviews where we cannot tell who wrote them (Google
 * now). Read from our saved copy; Refresh asks Google for new ones. A reply is
 * public on Google at once. A review is never matched to a customer and raises
 * no ticket — with no mobile or email, a reviewer is not a contact or a lead.
 */
export function ReviewsWorkspace({ canReply }: { canReply: boolean }) {
    const [data, setData] = useState<ListReply | null>(null);
    const [page, setPage] = useState(1);
    const [stars, setStars] = useState<number[]>([]);
    const [replied, setReplied] = useState<Replied>("");
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [drafts, setDrafts] = useState<Record<number, string>>({});

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const q = new URLSearchParams({ page: String(page), ...(stars.length ? { stars: stars.join(",") } : {}), ...(replied ? { replied } : {}) });
            setData((await axios.get<ListReply>(`/api/reviews?${q}`)).data);
        } catch (e) {
            toast.error(extractApiError(e, "Could not load reviews"));
        } finally {
            setLoading(false);
        }
    }, [page, stars, replied]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on filter change; the old list stays on screen until the new one lands
        void load();
    }, [load]);

    const patchRow = (id: number, patch: Partial<Review>) =>
        setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : d));

    async function refresh() {
        setBusy("sync");
        try {
            const { data: res } = await axios.post<{ saved: number; skipped?: string }>("/api/reviews/sync");
            if (res.skipped) toast.warning(res.skipped);
            else toast.success(res.saved ? `${res.saved} new or changed review${res.saved === 1 ? "" : "s"}` : "No new reviews");
            await load();
        } catch (e) {
            toast.error(extractApiError(e, "Could not refresh from Google"));
        } finally {
            setBusy(null);
        }
    }

    async function saveReply(r: Review) {
        const comment = (drafts[r.id] ?? r.draftText ?? r.replyText ?? "").trim();
        if (!comment) return;
        const before = { replyText: r.replyText, repliedAt: r.repliedAt, repliedByName: r.repliedByName, draftText: r.draftText };
        patchRow(r.id, { replyText: comment, repliedAt: new Date().toISOString(), draftText: null });
        setBusy(`reply-${r.id}`);
        try {
            const { data: row } = await axios.put<Review>(`/api/reviews/${r.id}/reply`, { comment });
            patchRow(r.id, { replyText: row.replyText, repliedAt: row.repliedAt, repliedByName: row.repliedByName });
            setDrafts(({ [r.id]: _, ...rest }) => rest);
            toast.success("Reply is live on Google");
        } catch (e) {
            patchRow(r.id, before);
            toast.error(extractApiError(e, "Reply not saved"));
        } finally {
            setBusy(null);
        }
    }

    async function deleteReply(r: Review) {
        if (!window.confirm("Remove the shop's reply from Google?")) return;
        const before = { replyText: r.replyText, repliedAt: r.repliedAt, repliedByName: r.repliedByName };
        patchRow(r.id, { replyText: null, repliedAt: null, repliedByName: null });
        setBusy(`reply-${r.id}`);
        try {
            await axios.delete(`/api/reviews/${r.id}/reply`);
            toast.success("Reply removed");
        } catch (e) {
            patchRow(r.id, before);
            toast.error(extractApiError(e, "Reply not removed"));
        } finally {
            setBusy(null);
        }
    }

    async function discardDraft(r: Review) {
        patchRow(r.id, { draftText: null });
        setDrafts(({ [r.id]: _, ...rest }) => rest);
        setBusy(`reply-${r.id}`);
        try {
            await axios.delete(`/api/reviews/${r.id}/draft`);
        } catch (e) {
            patchRow(r.id, { draftText: r.draftText });
            toast.error(extractApiError(e, "Draft not discarded"));
        } finally {
            setBusy(null);
        }
    }

    const toggleStar = (n: number) => {
        setPage(1);
        setStars((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]));
    };

    const google = data?.google;

    return (
        <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
                <h1 className="mr-auto text-lg font-semibold">
                    Reviews {data ? <span className="text-sm font-normal text-muted-foreground">· {data.waiting} waiting for a reply{data.drafts ? ` · ${data.drafts} draft${data.drafts === 1 ? "" : "s"} to check` : ""}</span> : null}
                </h1>
                {canReply && (
                    <Button size="sm" variant="outline" onClick={refresh} disabled={busy === "sync" || !google?.ready}>
                        <RefreshCw className={cn("size-4", busy === "sync" && "animate-spin")} /> Refresh from Google
                    </Button>
                )}
            </div>

            {google && !google.ready && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                    {google.setupProblem ?? "Google Business Profile is not connected, or no listing is picked."} Set it up on{" "}
                    <Link className="underline" href="/office/campaigns/channels">Campaigns → Channels</Link>.
                </p>
            )}
            {google?.ready && google.lastError && (
                <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                    Last Google problem: {google.lastError}
                </p>
            )}

            <div className="flex flex-wrap items-center gap-2 text-sm">
                {([["", "All"], ["no", "Waiting"], ["draft", "Drafts"], ["yes", "Replied"]] as const).map(([v, label]) => (
                    <Button key={v} size="sm" variant={replied === v ? "default" : "outline"} onClick={() => { setPage(1); setReplied(v); }}>
                        {label}
                    </Button>
                ))}
                <span className="ml-2 text-muted-foreground">Stars:</span>
                {[1, 2, 3, 4, 5].map((n) => (
                    <Button key={n} size="sm" variant={stars.includes(n) ? "default" : "outline"} onClick={() => toggleStar(n)}>
                        {n}★
                    </Button>
                ))}
            </div>

            {!data && loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {data && !data.rows.length && (
                <p className="text-sm text-muted-foreground">{google?.ready ? "No reviews match. Refresh to pull new ones from Google." : "No reviews yet."}</p>
            )}

            <ul className={cn("flex flex-col gap-3", loading && "opacity-60")}>
                {data?.rows.map((r) => {
                    const draft = drafts[r.id] ?? r.draftText ?? r.replyText ?? "";
                    const changed = draft.trim() !== (r.replyText ?? "") && !!draft.trim();
                    return (
                        <li key={r.id} className="rounded-lg border bg-card p-4">
                            <div className="flex items-start gap-3">
                                {r.reviewerPhoto ? (
                                    // eslint-disable-next-line @next/next/no-img-element -- Google's own photo link, not ours to optimise
                                    <img src={r.reviewerPhoto} alt="" className="size-9 rounded-full" referrerPolicy="no-referrer" />
                                ) : (
                                    <div className="flex size-9 items-center justify-center rounded-full bg-muted text-sm font-medium">
                                        {(r.reviewerName ?? "?").charAt(0).toUpperCase()}
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <span className="font-medium">{r.reviewerName ?? "Anonymous"}</span>
                                        <Stars n={r.stars} />
                                        <span className="text-xs text-muted-foreground">
                                            {PLATFORM_LABEL[r.platform] ?? r.platform} · {dateText(r.reviewedAt)}
                                        </span>
                                    </div>
                                    {r.comment ? <p className="mt-1 whitespace-pre-wrap text-sm">{r.comment}</p> : <p className="mt-1 text-sm italic text-muted-foreground">Stars only, no comment.</p>}

                                    <div className="mt-3 rounded-md bg-muted/50 p-3">
                                        {canReply ? (
                                            <>
                                                {r.draftText && (
                                                    <p className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                                                        Draft by {r.draftByName ?? "agent"}{r.draftedAt ? ` · ${dateText(r.draftedAt)}` : ""} — check it, then Post reply. Not on Google yet.
                                                    </p>
                                                )}
                                                <Textarea
                                                    value={draft}
                                                    onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                                                    placeholder="Write the shop's reply. It shows on Google for everyone."
                                                    maxLength={4096}
                                                    rows={2}
                                                />
                                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                                    <Button size="sm" onClick={() => saveReply(r)} disabled={!changed || busy === `reply-${r.id}`}>
                                                        {r.replyText ? "Update reply" : "Post reply"}
                                                    </Button>
                                                    {r.replyText && (
                                                        <Button size="sm" variant="ghost" onClick={() => deleteReply(r)} disabled={busy === `reply-${r.id}`}>
                                                            <Trash2 className="size-4" /> Remove
                                                        </Button>
                                                    )}
                                                    {r.draftText && (
                                                        <Button size="sm" variant="ghost" onClick={() => discardDraft(r)} disabled={busy === `reply-${r.id}`}>
                                                            Discard draft
                                                        </Button>
                                                    )}
                                                    {r.repliedAt && (
                                                        <span className="text-xs text-muted-foreground">
                                                            Replied {dateText(r.repliedAt)}{r.repliedByName ? ` by ${r.repliedByName}` : ""}
                                                        </span>
                                                    )}
                                                </div>
                                            </>
                                        ) : r.replyText ? (
                                            <p className="whitespace-pre-wrap text-sm">
                                                <span className="font-medium">Shop&apos;s reply: </span>
                                                {r.replyText}
                                            </p>
                                        ) : (
                                            <p className="text-sm text-muted-foreground">Not replied yet.</p>
                                        )}
                                    </div>

                                </div>
                            </div>
                        </li>
                    );
                })}
            </ul>

            {data && data.total > data.pageSize && (
                <PaginationBar total={data.total} page={page} pageSize={data.pageSize} onPageChange={setPage} unitLabel="review" />
            )}
        </div>
    );
}

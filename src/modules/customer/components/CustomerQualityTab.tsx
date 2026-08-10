"use client";

// Customer Quality tab — internal-only staff knowledge about a customer:
//   • No-discount flag (customers:edit gated, credit-limit style — visible to
//     all, disabled without the tick). Flagged = bills at barcode price.
//   • 1–5 star rating + behaviour comments — one append-only timeline, any
//     staff can add from here or from the POS customer panel.
// The customer never sees any of this. StarRating / QualityTimeline are also
// used by PosCustomerPanel — keep them presentation-only.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Ban, MessageSquarePlus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import UserAvatar from "@/shared/components/UserAvatar";
import { extractApiError } from "@/shared/lib/api";
import { timeAgo } from "@/shared/lib/format/timeAgo";
import {
    latestRating,
    parseQualityLog,
    type QualityLogEntry,
} from "@/modules/customer/lib/customerQuality";

// ── Small shared pieces (also used in the POS customer panel) ────────────────

export function StarRating({
    value, onRate, sizePx = 18, disabled = false,
}: {
    value: number | null;
    /** When present the stars are clickable and submit a new rating. */
    onRate?: (stars: number) => void;
    sizePx?: number;
    disabled?: boolean;
}) {
    return (
        <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
                <button
                    key={n}
                    type="button"
                    disabled={!onRate || disabled}
                    onClick={() => onRate?.(n)}
                    className={onRate ? "cursor-pointer disabled:cursor-default" : "cursor-default"}
                    title={onRate ? `Rate ${n} star${n > 1 ? "s" : ""}` : undefined}
                >
                    <Star
                        size={sizePx}
                        className={
                            value != null && n <= value
                                ? "fill-amber-400 text-amber-400"
                                : "text-muted-foreground/65"
                        }
                    />
                </button>
            ))}
        </div>
    );
}

export function QualityTimeline({ log, compact = false }: { log: QualityLogEntry[]; compact?: boolean }) {
    if (log.length === 0) {
        return <p className="text-sm text-muted-foreground">No entries yet.</p>;
    }
    return (
        <ul className="space-y-3">
            {[...log].reverse().map((e, i) => (
                <li key={`${e.at}-${i}`} className="flex gap-2.5">
                    <UserAvatar avatarUrl={e.authorAvatarUrl} name={e.authorName} sizePx={compact ? 24 : 30} />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-sm font-medium">{e.authorName}</span>
                            <span className="text-xs text-muted-foreground" title={new Date(e.at).toLocaleString()}>
                                {timeAgo(e.at)}
                            </span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                {e.source === "pos" ? (e.counterNo ? `POS · ${e.counterNo}` : "POS") : "Office"}
                            </span>
                        </div>
                        {e.type === "rating" ? (
                            <StarRating value={e.stars ?? null} sizePx={compact ? 12 : 14} />
                        ) : (
                            <p className="whitespace-pre-wrap text-sm text-foreground/90">{e.text}</p>
                        )}
                    </div>
                </li>
            ))}
        </ul>
    );
}

// ── The tab ──────────────────────────────────────────────────────────────────

interface Props {
    party: { kind: "person" | "company"; id: number };
    initialNoDiscount: boolean;
    initialQualityLog: unknown;
    /** customers:edit — gates ONLY the no-discount flag (credit-limit style). */
    canEditCustomer: boolean;
    onSaved: () => void;
}

export default function CustomerQualityTab({
    party, initialNoDiscount, initialQualityLog, canEditCustomer, onSaved,
}: Props) {
    const [noDiscount, setNoDiscount] = useState(initialNoDiscount);
    const [log, setLog] = useState<QualityLogEntry[]>(() => parseQualityLog(initialQualityLog));
    const [comment, setComment] = useState("");
    const [busy, setBusy] = useState(false);

    const rating = latestRating(log);

    const saveFlag = async (next: boolean) => {
        const prev = noDiscount;
        setNoDiscount(next);
        try {
            const base = party.kind === "person" ? "/api/person" : "/api/companies";
            await axios.put(`${base}/${party.id}`, { noDiscount: next });
            toast.success(next ? "No-discount flag set" : "No-discount flag removed");
            onSaved();
        } catch (e) {
            setNoDiscount(prev);
            toast.error(extractApiError(e, "Could not change the flag"));
        }
    };

    const append = async (payload: { type: "rating"; stars: number } | { type: "comment"; text: string }) => {
        setBusy(true);
        try {
            const { data } = await axios.post<{ qualityLog: QualityLogEntry[] }>("/api/customer-quality", {
                [party.kind === "person" ? "personId" : "companyId"]: party.id,
                source: "office",
                ...payload,
            });
            setLog(data.qualityLog);
            if (payload.type === "comment") setComment("");
            onSaved();
        } catch (e) {
            toast.error(extractApiError(e, "Could not add the entry"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="max-w-2xl space-y-6">
            {/* ── No-discount flag (customers:edit gated, like credit limit) ── */}
            <fieldset
                disabled={!canEditCustomer}
                className={`border-0 p-0 ${canEditCustomer ? "" : "opacity-60"}`}
            >
                <div className={`rounded-lg border p-4 ${noDiscount ? "border-destructive/50 bg-destructive/5" : "border-border"}`}>
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <Ban size={15} className={noDiscount ? "text-destructive" : "text-muted-foreground"} />
                            <p className="text-sm font-medium">No discount — bill at barcode price</p>
                        </div>
                        <Switch checked={noDiscount} onCheckedChange={(v) => void saveFlag(v)} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                        Flagged customer gets no automatic benefits anywhere — tier discount, coupons and
                        loyalty (earn + redeem) are all blocked, silently, on POS and the online shop.
                        The cashier&apos;s manual discount still works.
                        {!canEditCustomer && " You don't have permission to change this flag."}
                    </p>
                </div>
            </fieldset>

            {/* ── Rating ── */}
            <div className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-medium">Customer rating</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Click to give your rating — the latest rating counts.
                        </p>
                    </div>
                    <StarRating value={rating} onRate={(stars) => void append({ type: "rating", stars })} sizePx={22} disabled={busy} />
                </div>
            </div>

            {/* ── Add comment ── */}
            <div className="space-y-2">
                <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Note this customer's behaviour — what should the next staff member know?"
                    rows={2}
                    className="text-sm"
                />
                <Button
                    size="sm"
                    onClick={() => { if (comment.trim()) void append({ type: "comment", text: comment.trim() }); }}
                    disabled={busy || !comment.trim()}
                >
                    <MessageSquarePlus size={14} className="mr-1" /> Add comment
                </Button>
            </div>

            {/* ── Timeline ── */}
            <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Timeline</p>
                <QualityTimeline log={log} />
            </div>
        </div>
    );
}

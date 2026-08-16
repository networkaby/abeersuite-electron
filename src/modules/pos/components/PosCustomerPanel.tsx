"use client";

// Shared POS "we know you" customer panel — the right-hand column used by the
// Sale screen (PosScreen) and the Order / Estimate screen (PosQuoteScreen). The
// two carried a byte-identical copy of this panel; it now lives here once.
//
// Renders the whole <aside>: empty state, loading state, and the populated
// profile (identity, money/credit, offers, loyalty, tickets, warranties,
// Customer Quality rating + staff notes).

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
    User, Building2, Phone, Mail, MapPin,
    CreditCard, Wallet, TrendingDown, AlertCircle, Sparkles, ChevronRight,
    TrendingUp, Award, Clock, Star, Tag, Crown, MessageSquarePlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatInr } from "@/shared/lib/format";
import { extractApiError } from "@/shared/lib/api";
import { type Snapshot } from "@/modules/pos/lib/posDraftTypes";
import { type TierResult } from "@/shared/lib/pricing";
import { StarRating, QualityTimeline } from "@/modules/customer/components/CustomerQualityTab";
import { latestRating, type QualityLogEntry } from "@/modules/customer/lib/customerQuality";

// Pastel card + label tints — same palette language as the POS header/rail,
// so the profile panel reads colorful instead of monochrome.
const tintCard = {
    emerald: "border-emerald-300/50 bg-emerald-50/50 dark:border-emerald-500/30 dark:bg-emerald-950/20",
    rose:    "border-rose-300/50 bg-rose-50/50 dark:border-rose-500/30 dark:bg-rose-950/20",
    amber:   "border-amber-300/50 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-950/20",
    indigo:  "border-indigo-300/50 bg-indigo-50/50 dark:border-indigo-500/30 dark:bg-indigo-950/20",
    sky:     "border-sky-300/50 bg-sky-50/50 dark:border-sky-500/30 dark:bg-sky-950/20",
    violet:  "border-violet-300/50 bg-violet-50/50 dark:border-violet-500/30 dark:bg-violet-950/20",
} as const;
const tintText = {
    emerald: "text-emerald-700 dark:text-emerald-300",
    rose:    "text-rose-700 dark:text-rose-300",
    amber:   "text-amber-700 dark:text-amber-300",
    indigo:  "text-indigo-700 dark:text-indigo-300",
    sky:     "text-sky-700 dark:text-sky-300",
    violet:  "text-violet-700 dark:text-violet-300",
} as const;
type StatTint = keyof typeof tintCard;

const since = (iso: string | null) => {
    if (!iso) return "never";
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (days < 1) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days} days ago`;
    if (days < 365) return `${Math.floor(days / 30)} mo ago`;
    return `${Math.floor(days / 365)} yr ago`;
};

/**
 * The right-hand column: empty / loading / populated customer profile.
 *
 * `tier` comes from usePosBilling, NOT from the snapshot — it is resolved against the
 * live cart, so a CURRENT_SALE title appears as the bill grows. The snapshot's own
 * tier fields are the history-only view and would go stale here.
 */
export function PosCustomerPanel({ snapshot, loading, tier, counterNo, onOpenUpsell, offersReadyCount }: {
    snapshot: Snapshot | null;
    loading: boolean;
    tier: TierResult;
    counterNo?: string | null;
    /** Open the Upsell & Cross-sell drawer (slides left over the cart). */
    onOpenUpsell: () => void;
    /** Live "ready" offer count — badges the drawer trigger. */
    offersReadyCount: number;
}) {
    return (
        <aside className="flex min-w-0 flex-col overflow-y-auto bg-muted/30 p-3">
            {!snapshot ? (
                <div className="flex h-full flex-col items-center justify-center px-4 text-center text-muted-foreground">
                    <div className="mb-2 rounded-full bg-muted p-2.5">
                        <User size={20} className="opacity-50" />
                    </div>
                    <p className="text-sm font-medium text-foreground/80">No customer selected</p>
                    <p className="mt-0.5 text-xs">Search by name, phone or email above.</p>
                </div>
            ) : loading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (
                // Keyed by party so the quality-log local state resets on customer switch.
                <CustomerPanel key={`${snapshot.party.kind}-${snapshot.party.id}`} snapshot={snapshot} tier={tier} counterNo={counterNo ?? null} onOpenUpsell={onOpenUpsell} offersReadyCount={offersReadyCount} />
            )}
        </aside>
    );
}

function CustomerPanel({ snapshot, tier, counterNo, onOpenUpsell, offersReadyCount }: {
    snapshot: Snapshot;
    tier: TierResult;
    counterNo: string | null;
    onOpenUpsell: () => void;
    offersReadyCount: number;
}) {
    const c = snapshot.party;

    // Detect walk-in ledger by name — the seeded "Walk-in Cash Customer" ledger
    // lives under Sundry Debtors and is used for anonymous counter sales.
    const isWalkIn = c.name.toLowerCase().includes("walk-in") || c.name.toLowerCase().includes("cash-walkin");

    // Customer Quality — rating + staff notes, appendable right from the counter.
    const [log, setLog] = useState<QualityLogEntry[]>(snapshot.qualityLog ?? []);
    const [note, setNote] = useState("");
    const [qualityBusy, setQualityBusy] = useState(false);
    const rating = latestRating(log);
    const comments = log.filter((e) => e.type === "comment");

    const appendQuality = async (payload: { type: "rating"; stars: number } | { type: "comment"; text: string }) => {
        setQualityBusy(true);
        try {
            const { data } = await axios.post<{ qualityLog: QualityLogEntry[] }>("/api/customer-quality", {
                [c.kind === "person" ? "personId" : "companyId"]: c.id,
                source: "pos",
                ...(counterNo ? { counterNo } : {}),
                ...payload,
            });
            setLog(data.qualityLog);
            if (payload.type === "comment") setNote("");
        } catch (e) {
            toast.error(extractApiError(e, "Could not save"));
        } finally {
            setQualityBusy(false);
        }
    };

    const level = tier.badgeLevelName;
    const levelColor =
        level === "Platinum" ? "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" :
            level === "Gold" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" :
                level === "Silver" ? "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" :
                    "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300";
    return (
        <div className="space-y-2">
            {/* Identity */}
            <div>
                <div className="flex items-center gap-1.5">
                    {c.kind === "company" ? <Building2 size={14} className="shrink-0 text-muted-foreground" /> : <User size={14} className="shrink-0 text-muted-foreground" />}
                    <h2 className="truncate text-sm font-semibold">{c.name}</h2>
                    {isWalkIn && <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">Walk-in</Badge>}
                    {level && <Badge className={`text-[10px] ${levelColor}`}>{level}</Badge>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                    {c.phone && <span className="inline-flex items-center gap-1"><Phone size={10} /> {c.phone}</span>}
                    {c.email && <span className="inline-flex items-center gap-1"><Mail size={10} /> {c.email}</span>}
                    {c.gstin && <span className="font-mono">GSTIN {c.gstin}</span>}
                    {c.address && <span className="inline-flex basis-full items-start gap-1"><MapPin size={10} className="mt-0.5 shrink-0" /> <span className="whitespace-pre-line">{c.address}</span></span>}
                </div>
            </div>

            {/* Money — credit / due / overdue (risk-at-a-glance) */}
            <div className="grid grid-cols-3 gap-1">
                <Stat
                    icon={<CreditCard size={14} />}
                    label="Avail. credit"
                    value={snapshot.availableCredit != null ? formatInr(snapshot.availableCredit) : "Unlimited"}
                    sub={snapshot.creditLimit != null ? `limit ${formatInr(snapshot.creditLimit)}` : "no limit set"}
                    tint="emerald"
                />
                {/* Due — sign-aware: flips to "Advance" (green) when the ledger is
                    in credit, so it absorbs the old separate ledger-balance row. */}
                {(() => {
                    const bal = snapshot.account ? snapshot.account.balance : snapshot.balanceDue;
                    const credit = bal < 0;
                    return (
                        <Stat
                            icon={credit ? <Wallet size={14} /> : <TrendingDown size={14} />}
                            label={credit ? "Advance" : "Due"}
                            value={formatInr(credit ? Math.abs(bal) : snapshot.balanceDue)}
                            sub={credit ? "in their favour" : snapshot.balanceDue > 0 ? "outstanding" : "clean"}
                            valueClass={credit ? "text-emerald-600 dark:text-emerald-400" : undefined}
                            tint={credit ? "emerald" : "rose"}
                        />
                    );
                })()}
                <Stat
                    icon={<AlertCircle size={14} />}
                    label="Overdue"
                    value={formatInr(snapshot.balanceOverdue)}
                    sub={snapshot.balanceOverdue > 0 ? "past due" : "—"}
                    tint="rose"
                />
            </div>

            {/* Upsell & cross-sell — the whole box opens the drawer (slides left
                over the cart). The snapshot's personalized offers stay as a teaser;
                the live qualification list + add-ons live in the drawer. */}
            <button
                type="button"
                onClick={onOpenUpsell}
                className="w-full rounded-md border border-emerald-300/50 bg-linear-to-br from-emerald-500/10 to-transparent p-2 text-left transition-colors hover:border-emerald-400/70 hover:from-emerald-500/15"
            >
                <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    <Sparkles size={11} /> Upsell &amp; cross-sell
                    <span className="ml-auto flex items-center gap-1">
                        {offersReadyCount > 0 && (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                {offersReadyCount} ready
                            </span>
                        )}
                        <ChevronRight size={12} />
                    </span>
                </div>
                {snapshot.personalizedOffers.length > 0 ? (
                    <ul className="space-y-1">
                        {snapshot.personalizedOffers.map((o) => (
                            <li key={o.id} className="flex items-center justify-between gap-2 rounded border border-emerald-300/40 bg-card px-2 py-1 text-xs">
                                <span className="truncate">{o.label}</span>
                                <Badge variant="secondary" className="shrink-0 text-[10px]">{o.tag}</Badge>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-[10px] text-muted-foreground">
                        {snapshot.favouriteCategory
                            ? <>No offer yet — they favour <span className="font-medium text-foreground">{snapshot.favouriteCategory}</span>.</>
                            : "Pitch an accessory, warranty, or AMC — open for live offers."}
                    </p>
                )}
            </button>

            {/* Titles held — one per period whose bracket of spend cleared a level. */}
            {tier.titles.length > 0 && (
                <div className="rounded-md border border-amber-300/40 bg-amber-500/5 p-2">
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        <Crown size={10} /> Titles held
                    </div>
                    <ul className="space-y-1">
                        {tier.titles.map((t) => (
                            <li key={t.periodId} className="flex items-center gap-1.5 text-xs">
                                <span className="min-w-0 flex-1 truncate">
                                    <span className="font-medium">{t.levelName}</span>
                                    <span className="text-muted-foreground"> · {t.periodName}</span>
                                </span>
                                <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                                    {formatInr(t.spend)} · {t.fromDay}–{t.toDay}d{t.includesCurrentSale ? " + bill" : ""}
                                </span>
                                <Badge variant="secondary" className="shrink-0 tabular-nums text-[10px]">+{t.discountPct}%</Badge>
                            </li>
                        ))}
                    </ul>
                    {(tier.titles.length > 1 || tier.cappedByGuard) && (
                        <div className="mt-1 flex items-center justify-between border-t border-amber-300/40 pt-1 text-[10px]">
                            <span className="text-muted-foreground">Total discount</span>
                            <span className="flex items-center gap-1">
                                {tier.cappedByGuard && (
                                    <span className="text-muted-foreground line-through tabular-nums">{tier.rawPct}%</span>
                                )}
                                <span className="font-medium tabular-nums">{tier.discountPct}%</span>
                                {tier.cappedByGuard && (
                                    <span className="text-amber-700 dark:text-amber-400">capped at {tier.capPct}%</span>
                                )}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* Value & loyalty */}
            <div className="grid grid-cols-2 gap-1">
                <Stat tint="indigo" icon={<TrendingUp size={12} />} label="Lifetime" value={formatInr(snapshot.turnover.lifetime)} sub={`${snapshot.turnover.invoiceCount} invoices`} />
                <Stat tint="sky" icon={<TrendingUp size={12} />} label="Last 12 mo" value={formatInr(snapshot.turnover.last12Months)} />
                <Stat tint="amber" icon={<Award size={12} />} label="Loyalty" value={String(snapshot.loyaltyPoints)} sub={snapshot.loyaltyRates?.enabled ? `worth ${formatInr(snapshot.loyaltyPoints * snapshot.loyaltyRates.redeemValue)}` : tier.discountPct > 0 ? `${tier.discountPct}% tier` : "No tier"} />
                <Stat tint="violet" icon={<Clock size={12} />} label="Visit" value={since(snapshot.lastVisitAt)} />
            </div>

            {/* Rating (tap to rate) + favourite category */}
            <div className="grid grid-cols-2 gap-1">
                <div className="rounded-md border border-amber-300/50 bg-amber-50/50 px-2 py-1 dark:border-amber-500/30 dark:bg-amber-950/20">
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300">
                        <Star size={12} /> Rating
                    </div>
                    <div className="mt-0.5">
                        <StarRating value={rating} onRate={(stars) => void appendQuality({ type: "rating", stars })} sizePx={12} disabled={qualityBusy} />
                    </div>
                    <div className="text-[10px] leading-tight text-muted-foreground">{rating == null ? "tap to rate" : "tap to re-rate"}</div>
                </div>
                <Stat
                    icon={<Tag size={12} />}
                    label="Favourite"
                    value={snapshot.favouriteCategory ?? "—"}
                    sub={snapshot.favouriteCategory == null ? "needs invoice link" : undefined}
                    tint="rose"
                />
            </div>

            {/* Staff notes */}
            <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Staff notes</div>
                <div className="flex gap-1">
                    <Input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) void appendQuality({ type: "comment", text: note.trim() }); }}
                        placeholder="Note behaviour…"
                        className="h-7 flex-1 text-xs"
                    />
                    <Button
                        size="icon-xs"
                        variant="outline"
                        onClick={() => { if (note.trim()) void appendQuality({ type: "comment", text: note.trim() }); }}
                        disabled={qualityBusy || !note.trim()}
                        title="Add note"
                    >
                        <MessageSquarePlus size={12} />
                    </Button>
                </div>
                {comments.length > 0 && (
                    <div className="mt-1.5 rounded-md border border-border bg-card p-2">
                        <QualityTimeline log={comments.slice(-3)} compact />
                    </div>
                )}
            </div>

            {snapshot.recentTickets.length > 0 && (
                <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent tickets</div>
                    <ul className="space-y-1">
                        {snapshot.recentTickets.map((t) => (
                            <li key={t.id} className="flex items-center justify-between rounded border border-border bg-card px-2 py-1 text-xs">
                                <span className="font-mono">#{t.id}</span>
                                <Badge variant="secondary" className="text-[10px]">{t.statusLabel}</Badge>
                                <span className="text-muted-foreground">{since(t.createdAt)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {snapshot.warrantiesEnding.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
                    <div className="mb-1 font-semibold text-amber-700">Warranties ending soon</div>
                    {snapshot.warrantiesEnding.map((w) => (
                        <div key={w.productName} className="flex items-center justify-between">
                            <span className="truncate">{w.productName}</span>
                            <span className="text-muted-foreground">{w.endsAt}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function Stat({ icon, label, value, sub, valueClass, tint }: { icon: React.ReactNode; label: string; value: string; sub?: string; valueClass?: string; tint?: StatTint }) {
    return (
        <div className={`rounded-md border px-2 py-1 ${tint ? tintCard[tint] : "border-border bg-card"}`}>
            <div className={`flex items-center gap-1 text-[10px] uppercase tracking-wider ${tint ? tintText[tint] : "text-muted-foreground"}`}>
                {icon} {label}
            </div>
            <div className={`mt-0.5 text-xs font-semibold leading-tight tabular-nums ${valueClass ?? ""}`}>{value}</div>
            {sub && <div className="text-[10px] leading-tight text-muted-foreground">{sub}</div>}
        </div>
    );
}

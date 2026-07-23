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
    CreditCard, Wallet, TrendingDown, AlertCircle, Sparkles,
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
export function PosCustomerPanel({ snapshot, loading, tier, counterNo }: { snapshot: Snapshot | null; loading: boolean; tier: TierResult; counterNo?: string | null }) {
    return (
        <aside className="flex min-h-0 flex-col overflow-y-auto bg-muted/30 p-4">
            {!snapshot ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted-foreground">
                    <div className="mb-2 rounded-full bg-muted p-3">
                        <User size={24} className="opacity-50" />
                    </div>
                    <p className="text-sm font-medium text-foreground/80">No customer selected</p>
                    <p className="mt-0.5 text-xs">Search by name, phone or email above — or add a walk-in to see their dues, loyalty &amp; offers.</p>
                </div>
            ) : loading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (
                // Keyed by party so the quality-log local state resets on customer switch.
                <CustomerPanel key={`${snapshot.party.kind}-${snapshot.party.id}`} snapshot={snapshot} tier={tier} counterNo={counterNo ?? null} />
            )}
        </aside>
    );
}

function CustomerPanel({ snapshot, tier, counterNo }: { snapshot: Snapshot; tier: TierResult; counterNo: string | null }) {
    const c = snapshot.party;

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
        <div className="space-y-3">
            {/* Identity */}
            <div>
                <div className="flex items-center gap-2">
                    {c.kind === "company" ? <Building2 size={16} className="shrink-0 text-muted-foreground" /> : <User size={16} className="shrink-0 text-muted-foreground" />}
                    <h2 className="truncate text-base font-semibold">{c.name}</h2>
                    {level && <Badge className={`text-[10px] ${levelColor}`}>{level}</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {c.phone && <span className="inline-flex items-center gap-1"><Phone size={11} /> {c.phone}</span>}
                    {c.email && <span className="inline-flex items-center gap-1"><Mail size={11} /> {c.email}</span>}
                    {c.gstin && <span className="font-mono">GSTIN {c.gstin}</span>}
                    {c.address && <span className="inline-flex basis-full items-start gap-1"><MapPin size={11} className="mt-0.5 shrink-0" /> <span className="whitespace-pre-line">{c.address}</span></span>}
                </div>
            </div>

            {/* Money — credit / due / overdue (risk-at-a-glance) */}
            <div className="grid grid-cols-3 gap-1.5">
                <Stat
                    icon={<CreditCard size={14} />}
                    label="Avail. credit"
                    value={snapshot.availableCredit != null ? formatInr(snapshot.availableCredit) : "Unlimited"}
                    sub={snapshot.creditLimit != null ? `limit ${formatInr(snapshot.creditLimit)}` : "no limit set"}
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
                        />
                    );
                })()}
                <Stat
                    icon={<AlertCircle size={14} />}
                    label="Overdue"
                    value={formatInr(snapshot.balanceOverdue)}
                    sub={snapshot.balanceOverdue > 0 ? "past due" : "—"}
                />
            </div>

            {/* Offers & cross-sell — pulled up and highlighted so the cashier
                pitches before checkout. Empty state nudges an add-on/AMC sale. */}
            {snapshot.personalizedOffers.length > 0 ? (
                <div className="rounded-lg border border-emerald-300/50 bg-gradient-to-br from-emerald-500/10 to-transparent p-2.5">
                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                        <Sparkles size={12} /> Offers to pitch
                    </div>
                    <ul className="space-y-1.5">
                        {snapshot.personalizedOffers.map((o) => (
                            <li key={o.id} className="flex items-center justify-between gap-2 rounded-md border border-emerald-300/40 bg-card px-2.5 py-1.5 text-xs">
                                <span className="truncate">{o.label}</span>
                                <Badge variant="secondary" className="shrink-0 text-[10px]">{o.tag}</Badge>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : (
                <div className="rounded-lg border border-dashed border-emerald-300/40 bg-emerald-500/5 p-2.5 text-[11px]">
                    <div className="mb-0.5 flex items-center gap-1 font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                        <Sparkles size={11} /> Upsell &amp; cross-sell
                    </div>
                    <p className="text-muted-foreground">
                        {snapshot.favouriteCategory
                            ? <>No coupon yet — they favour <span className="font-medium text-foreground">{snapshot.favouriteCategory}</span>. Suggest an add-on, accessory, or AMC.</>
                            : "No targeted offer yet — pitch an accessory, extended warranty, or AMC."}
                    </p>
                </div>
            )}

            {/* Titles held — one per period whose bracket of spend cleared a level.
                Every one contributes its % (periods apply independently), so the rows
                add up to the discount shown on the bill. */}
            {tier.titles.length > 0 && (
                <div className="rounded-lg border border-amber-300/40 bg-amber-500/5 p-2.5">
                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        <Crown size={11} /> Titles held
                    </div>
                    <ul className="space-y-1">
                        {tier.titles.map((t) => (
                            <li key={t.periodId} className="flex items-center gap-2 text-xs">
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
                        <div className="mt-1.5 flex items-center justify-between border-t border-amber-300/40 pt-1.5 text-[11px]">
                            <span className="text-muted-foreground">Total discount</span>
                            <span className="flex items-center gap-1.5">
                                {/* Say so when the guard trimmed the stack — otherwise the
                                    rows visibly don't add up to the total. */}
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
            <div className="grid grid-cols-2 gap-1.5">
                <Stat icon={<TrendingUp size={14} />} label="Lifetime turnover" value={formatInr(snapshot.turnover.lifetime)} sub={`${snapshot.turnover.invoiceCount} invoices`} />
                <Stat icon={<TrendingUp size={14} />} label="Last 12 mo" value={formatInr(snapshot.turnover.last12Months)} />
                <Stat icon={<Award size={14} />} label="Loyalty points" value={String(snapshot.loyaltyPoints)} sub={snapshot.loyaltyRates?.enabled ? `worth ${formatInr(snapshot.loyaltyPoints * snapshot.loyaltyRates.redeemValue)} · 1 pt / ₹${snapshot.loyaltyRates.globalEarnRatePer}` : tier.discountPct > 0 ? `${tier.discountPct}% discount tier` : "No tier yet"} />
                <Stat icon={<Clock size={14} />} label="Last visit" value={since(snapshot.lastVisitAt)} />
            </div>

            {/* Rating (tap to rate) + favourite category */}
            <div className="grid grid-cols-2 gap-1.5">
                <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <Star size={14} /> Rating
                    </div>
                    <div className="mt-1">
                        <StarRating value={rating} onRate={(stars) => void appendQuality({ type: "rating", stars })} sizePx={15} disabled={qualityBusy} />
                    </div>
                    <div className="text-[10px] leading-tight text-muted-foreground">{rating == null ? "no rating — tap to rate" : "tap to re-rate"}</div>
                </div>
                <Stat
                    icon={<Tag size={14} />}
                    label="Favourite"
                    value={snapshot.favouriteCategory ?? "—"}
                    sub={snapshot.favouriteCategory == null ? "needs invoice link" : undefined}
                />
            </div>

            {/* Staff notes — behaviour knowledge from earlier dealings; add fresh
                ones right after dealing with the customer. Internal-only. */}
            <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Staff notes</div>
                {/* Input first — the cashier types without scrolling past old notes. */}
                <div className="flex gap-1.5">
                    <Input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) void appendQuality({ type: "comment", text: note.trim() }); }}
                        placeholder="Note this customer's behaviour…"
                        className="h-7 flex-1 text-xs"
                    />
                    <Button
                        size="icon-sm"
                        variant="outline"
                        onClick={() => { if (note.trim()) void appendQuality({ type: "comment", text: note.trim() }); }}
                        disabled={qualityBusy || !note.trim()}
                        title="Add note"
                    >
                        <MessageSquarePlus size={13} />
                    </Button>
                </div>
                {comments.length > 0 && (
                    <div className="mt-2 rounded-md border border-border bg-card p-2.5">
                        <QualityTimeline log={comments.slice(-3)} compact />
                    </div>
                )}
            </div>

            {snapshot.recentTickets.length > 0 && (
                <div>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent tickets</div>
                    <ul className="space-y-1.5">
                        {snapshot.recentTickets.map((t) => (
                            <li key={t.id} className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
                                <span className="font-mono">#{t.id}</span>
                                <Badge variant="secondary" className="text-[10px]">{t.statusLabel}</Badge>
                                <span className="text-muted-foreground">{since(t.createdAt)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {snapshot.warrantiesEnding.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs">
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

function Stat({ icon, label, value, sub, valueClass }: { icon: React.ReactNode; label: string; value: string; sub?: string; valueClass?: string }) {
    return (
        <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {icon} {label}
            </div>
            <div className={`mt-0.5 text-sm font-semibold leading-tight tabular-nums ${valueClass ?? ""}`}>{value}</div>
            {sub && <div className="text-[10px] leading-tight text-muted-foreground">{sub}</div>}
        </div>
    );
}

import { Gift, Star } from "lucide-react";
import type { PortalWallet } from "@/modules/external/portal/portalWallet";
import { formatRupees } from "@/shared/lib/format/moneyInr";
import { formatDate } from "@/shared/lib/format/formatDate";

const day = (iso: string) => formatDate(iso);

/**
 * A profile's wallet: loyalty points (balance, worth, next expiry, history) and
 * its gift cards. The portal and the customer app share it.
 */
export default function PortalWalletView({ wallet: w, profileLabel }: { wallet: PortalWallet; profileLabel: string }) {
    return (
        <div className="space-y-4">
            <section className="rounded-2xl bg-primary p-5 text-primary-foreground">
                <p className="flex items-center gap-1.5 text-xs opacity-85">
                    <Star className="size-3.5" /> Reward points · {profileLabel}
                </p>
                {w.loyaltyOn ? (
                    <>
                        <p className="mt-1 text-3xl font-bold tabular-nums">{w.points.toLocaleString("en-IN")} pts</p>
                        <p className="text-sm opacity-90">Worth {formatRupees(w.pointsValue)} on your next bill</p>
                        {w.nextExpiry && (
                            <p className="mt-2 text-xs opacity-85">
                                {w.nextExpiry.points} points lapse on {day(w.nextExpiry.on)}
                            </p>
                        )}
                        <p className="mt-3 flex gap-4 text-xs opacity-85">
                            <span>Earned {w.totalEarned.toLocaleString("en-IN")}</span>
                            <span>Used {w.totalRedeemed.toLocaleString("en-IN")}</span>
                        </p>
                    </>
                ) : (
                    <p className="mt-2 text-sm opacity-90">The shop has not started reward points yet.</p>
                )}
            </section>

            {w.giftCards.length > 0 && (
                <section className="space-y-2">
                    <h2 className="text-sm font-semibold">Gift cards</h2>
                    <ul className="space-y-2">
                        {w.giftCards.map((g) => (
                            <li key={g.id} className="flex items-center gap-3 rounded-xl border bg-background px-4 py-3">
                                <Gift className="size-5 text-rose-500" />
                                <span className="min-w-0 flex-1">
                                    <span className="block font-mono text-sm">•••• {g.last4}</span>
                                    <span className="block text-xs text-muted-foreground">{g.expiresAt ? `Valid till ${day(g.expiresAt)}` : "No expiry"}</span>
                                </span>
                                <span className="text-sm font-semibold tabular-nums">{formatRupees(g.balance)}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {w.loyaltyOn && (
                <section className="space-y-2">
                    <h2 className="text-sm font-semibold">Points history</h2>
                    {w.history.length === 0 ? (
                        <p className="rounded-xl border border-dashed bg-background px-4 py-6 text-center text-sm text-muted-foreground">
                            Points you earn on purchases show up here.
                        </p>
                    ) : (
                        <ul className="divide-y rounded-xl border bg-background">
                            {w.history.map((h) => (
                                <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-3">
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm">{h.label}</span>
                                        <span className="block text-xs text-muted-foreground">
                                            {day(h.at)}
                                            {h.reference ? ` · ${h.reference}` : ""}
                                        </span>
                                    </span>
                                    <span className={`shrink-0 text-sm font-semibold tabular-nums ${h.delta > 0 ? "text-emerald-700" : ""}`}>
                                        {h.delta > 0 ? "+" : "−"}
                                        {Math.abs(h.delta).toLocaleString("en-IN")}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}
        </div>
    );
}

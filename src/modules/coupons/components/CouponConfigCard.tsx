"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronDown, Save, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { parseDecimalInput } from "@/shared/lib/format";

interface Config {
    maxTotalDiscountPct: string | number | null;
    couponExpenseAccountId: number | null;
    giftCardLiabilityAccountId: number | null;
}

/// One compact stat tile in the collapsed header — a labelled value at a glance.
function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
    return (
        <div className="min-w-[88px] rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={`mt-0.5 text-sm font-semibold tabular-nums ${muted ? "text-muted-foreground" : ""}`}>{value}</div>
        </div>
    );
}

export function CouponConfigCard() {
    // Collapsed by default — the coupon list is the decision surface; this is
    // a rarely-touched guardrail, so it stays one slim row until opened.
    const [open, setOpen] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [maxPct, setMaxPct] = useState("");
    const [ledgers, setLedgers] = useState<{ coupon: number | null; gift: number | null }>({ coupon: null, gift: null });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        axios.get<Config>("/api/coupons/config")
            .then((r) => {
                setMaxPct(r.data.maxTotalDiscountPct == null ? "" : String(Number(r.data.maxTotalDiscountPct)));
                setLedgers({ coupon: r.data.couponExpenseAccountId, gift: r.data.giftCardLiabilityAccountId });
            })
            .catch(() => toast.error("Failed to load coupon config"))
            .finally(() => setLoaded(true));
    }, []);

    async function save() {
        setSaving(true);
        try {
            await axios.patch("/api/coupons/config", { maxTotalDiscountPct: maxPct.trim() === "" ? null : Number(maxPct) });
            toast.success("Saved");
        } catch {
            toast.error("Save failed");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Card>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 rounded-t-xl p-4 text-left transition-colors hover:bg-muted/30"
            >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                    <Shield size={16} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="text-sm font-semibold">Discount guard</span>
                    <span className="block text-xs text-muted-foreground">
                        Caps the combined coupon + spend-tier + loyalty discount on any bill.
                    </span>
                </span>
                <span className="hidden items-center gap-2 md:flex">
                    <Stat label="Max discount" value={!loaded ? "…" : maxPct ? `${maxPct}%` : "No cap"} muted={!loaded} />
                    <Stat label="Coupon GL" value={!loaded ? "…" : `#${ledgers.coupon ?? "—"}`} muted={!loaded} />
                    <Stat label="Gift card GL" value={!loaded ? "…" : `#${ledgers.gift ?? "—"}`} muted={!loaded} />
                </span>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}>
                    <ChevronDown className="size-4" />
                </span>
            </button>
            {open && (
                <CardContent className="grid gap-5 border-t pt-4 md:grid-cols-2">
                    {!loaded ? (
                        <p className="text-sm text-muted-foreground">Loading…</p>
                    ) : (
                        <>
                            {/* Cap editor */}
                            <div className="space-y-1.5">
                                <Label className="text-[11px] text-muted-foreground">Max total discount %</Label>
                                <div className="flex items-end gap-2">
                                    <div className="relative">
                                        <Input
                                            inputMode="decimal"
                                            value={maxPct}
                                            onChange={(e) => setMaxPct(parseDecimalInput(e.target.value))}
                                            placeholder="no cap"
                                            className="h-9 w-32 pr-7 text-right"
                                        />
                                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                                    </div>
                                    <Button size="sm" onClick={save} disabled={saving}>
                                        <Save size={14} className="mr-1" /> Save
                                    </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Leave blank for no cap. The same cap is editable from Spend Tiers.
                                </p>
                            </div>

                            {/* GL routing */}
                            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">GL routing</p>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="flex items-center gap-2 text-muted-foreground">
                                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                                        Coupon Discounts
                                    </span>
                                    <span className="font-mono text-xs tabular-nums">ledger #{ledgers.coupon ?? "—"}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="flex items-center gap-2 text-muted-foreground">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                        Gift Card Liability
                                    </span>
                                    <span className="font-mono text-xs tabular-nums">ledger #{ledgers.gift ?? "—"}</span>
                                </div>
                                <p className="pt-1 text-[11px] text-muted-foreground">
                                    Coupons post to the Coupon Discounts ledger; gift cards to Gift Card Liability. Re-run the bootstrap seed if missing.
                                </p>
                            </div>
                        </>
                    )}
                </CardContent>
            )}
        </Card>
    );
}

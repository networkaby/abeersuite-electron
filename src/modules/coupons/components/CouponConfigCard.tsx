"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Save, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseDecimalInput } from "@/shared/lib/format";

interface Config {
    maxTotalDiscountPct: string | number | null;
    couponExpenseAccountId: number | null;
    giftCardLiabilityAccountId: number | null;
}

export function CouponConfigCard() {
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
            <CardHeader className="space-y-1.5">
                <CardTitle className="flex items-center gap-2 text-base">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"><Shield size={15} /></span>
                    Discount guard
                </CardTitle>
                <CardDescription>
                    Caps the <span className="font-medium">total</span> discount on any bill (coupon + spend-tier + loyalty combined),
                    as a % of the goods value. Leave blank for no cap.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {!loaded ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                    <>
                        <div className="flex items-end gap-3">
                            <div className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">Max total discount %</Label>
                                <Input inputMode="decimal" value={maxPct} onChange={(e) => setMaxPct(parseDecimalInput(e.target.value))} placeholder="no cap" className="h-9 w-32 text-right" />
                            </div>
                            <Button size="sm" onClick={save} disabled={saving}><Save size={14} className="mr-1" /> Save</Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            GL routing — coupons post to ledger #{ledgers.coupon ?? "—"} (&ldquo;Coupon Discounts&rdquo;);
                            gift cards to #{ledgers.gift ?? "—"} (&ldquo;Gift Card Liability&rdquo;). Re-run the bootstrap seed if missing.
                        </p>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

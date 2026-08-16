"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Save, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseDecimalInput } from "@/shared/lib/format";

interface Config {
    maxTotalDiscountPct: string | number | null;
    couponExpenseAccountId: number | null;
    giftCardLiabilityAccountId: number | null;
}

/// Slim one-line guardrail at the top of the page: the max-discount % input and
/// a Save button. The GL ledgers are read-only hints — the accounts are set by
/// the bootstrap seed, not edited per coupon.
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Shield size={13} className="text-primary" />
                Max discount %
            </span>
            <div className="relative">
                <Input
                    inputMode="decimal"
                    value={maxPct}
                    onChange={(e) => setMaxPct(parseDecimalInput(e.target.value))}
                    placeholder={!loaded ? "…" : "no cap"}
                    disabled={!loaded}
                    className="h-8 w-24 pr-6 text-right"
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
            </div>
            <Button size="sm" className="h-8" onClick={save} disabled={saving || !loaded}>
                <Save size={13} className="mr-1" /> Save
            </Button>
            <span className="hidden text-[11px] text-muted-foreground/75 2xl:inline">
                Caps coupon + tier + loyalty per bill · GL coupon #{!loaded ? "…" : `#${ledgers.coupon ?? "—"}`} · gift card #{!loaded ? "…" : `#${ledgers.gift ?? "—"}`}
            </span>
        </div>
    );
}

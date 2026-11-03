"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Shield } from "lucide-react";
import { Input } from "@/components/ui/input";
import { parseDecimalInput } from "@/shared/lib/format";
import { extractApiError } from "@/shared/lib/api";

type CapField = "maxTotalDiscountPct" | "maxCouponDiscountPct" | "maxTierDiscountPct";

type Config = Record<CapField, string | number | null> & {
    couponExpenseAccountId: number | null;
    giftCardLiabilityAccountId: number | null;
};

const pctText = (v: string | number | null | undefined) => (v == null ? "" : String(Number(v)));

/// Two discount limits on one line: this page's own cap (coupon / tier — loyalty
/// keeps its own in its form, so it passes no `own`) and the combined cap for
/// coupon + tier + loyalty on one bill. Same CouponConfig row on every page;
/// each box saves on blur.
export function CouponConfigCard({ own, showLedgers }: {
    own?: { field: "maxCouponDiscountPct" | "maxTierDiscountPct"; label: string };
    showLedgers?: boolean;
}) {
    const [loaded, setLoaded] = useState(false);
    const [server, setServer] = useState<Partial<Record<CapField, string>>>({});
    const [draft, setDraft] = useState<Partial<Record<CapField, string>>>({});
    const [ledgers, setLedgers] = useState<{ coupon: number | null; gift: number | null }>({ coupon: null, gift: null });

    const load = useCallback((silent = false) => {
        axios.get<Config>("/api/coupons/config")
            .then((r) => {
                const next = {
                    maxTotalDiscountPct: pctText(r.data.maxTotalDiscountPct),
                    maxCouponDiscountPct: pctText(r.data.maxCouponDiscountPct),
                    maxTierDiscountPct: pctText(r.data.maxTierDiscountPct),
                };
                setServer(next);
                setDraft(next);
                setLedgers({ coupon: r.data.couponExpenseAccountId, gift: r.data.giftCardLiabilityAccountId });
            })
            .catch(() => { if (!silent) toast.error("Failed to load discount limits"); })
            .finally(() => setLoaded(true));
    }, []);

    useEffect(() => { load(); }, [load]);

    // Changed on another machine → agree, but never over a half-typed box.
    const dirty = (Object.keys(draft) as CapField[]).some((k) => draft[k] !== server[k]);
    useRealtimeTopics(["catalogue", "ledger"], () => { load(true); }, !dirty);

    async function save(field: CapField) {
        const value = draft[field] ?? "";
        if (value === server[field]) return;
        const pct = value.trim() === "" ? null : Number(value);
        if (pct !== null && (!Number.isFinite(pct) || pct > 100)) {
            toast.error("Enter a limit between 0 and 100, or leave it blank for none");
            return setDraft((d) => ({ ...d, [field]: server[field] }));
        }
        try {
            await axios.patch("/api/coupons/config", { [field]: pct });
            setServer((s) => ({ ...s, [field]: value }));
            toast.success(pct === null ? "Limit removed" : `Limit set to ${pct}%`);
        } catch (e) {
            toast.error(extractApiError(e, "Save failed"));
            setDraft((d) => ({ ...d, [field]: server[field] }));
        }
    }

    const box = (field: CapField, label: string, title: string) => (
        <label className="flex items-center gap-1.5" title={title}>
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <div className="relative">
                <Input
                    inputMode="decimal"
                    value={draft[field] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [field]: parseDecimalInput(e.target.value) }))}
                    onBlur={() => save(field)}
                    placeholder={!loaded ? "…" : "no cap"}
                    disabled={!loaded}
                    className="h-8 w-20 pr-6 text-right"
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
            </div>
        </label>
    );

    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Shield size={13} className="text-primary" />
            {own && box(own.field, own.label, "This discount alone, as a % of the bill goods. Blank = no limit of its own.")}
            {box("maxTotalDiscountPct", "All together max %", "Coupon + spend tier + loyalty on one bill, as a % of goods. Shared by the Coupons, Spend Tiers and Loyalty pages. Blank = no cap.")}
            {showLedgers && (
                <span className="hidden text-[11px] text-muted-foreground/75 2xl:inline">
                    GL coupon #{!loaded ? "…" : `#${ledgers.coupon ?? "—"}`} · gift card #{!loaded ? "…" : `#${ledgers.gift ?? "—"}`}
                </span>
            )}
        </div>
    );
}

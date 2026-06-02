"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Crown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface Tier {
    id: number;
    name: string;
    minSpend: string | number;
    discountPct: string | number;
    sortOrder: number;
}

const dec = (s: string): string => s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");

const tierStyle: Record<string, string> = {
    Platinum: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
    Gold:     "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    Silver:   "bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300",
    Bronze:   "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400",
};

export function LoyaltyTiers() {
    const [tiers, setTiers] = useState<Tier[]>([]);
    const [loading, setLoading] = useState(true);

    function load() {
        axios
            .get<Tier[]>("/api/loyalty/tiers")
            .then((r) => setTiers(r.data))
            .catch(() => toast.error("Failed to load tiers"))
            .finally(() => setLoading(false));
    }
    useEffect(load, []);

    async function patchTier(id: number, patch: { minSpend?: number; discountPct?: number }) {
        try {
            await axios.patch(`/api/loyalty/tiers/${id}`, patch);
            load();
        } catch {
            toast.error("Failed to update tier");
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"><Crown size={15} /></span>
                    Spend-tier discounts
                </CardTitle>
                <CardDescription>
                    Automatic discount by <span className="font-medium">lifetime spend</span> — applied on pre-GST goods at POS.
                    Separate from loyalty points (it posts to &ldquo;Discount Allowed&rdquo;).
                </CardDescription>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                    <ul className="divide-y rounded-lg border border-border/60">
                        {tiers.map((t) => (
                            <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                                <Badge variant="secondary" className={`w-20 justify-center shrink-0 text-[11px] ${tierStyle[t.name] ?? ""}`}>{t.name}</Badge>
                                <div className="flex flex-1 items-center gap-1.5" title="Lifetime spend to reach this tier">
                                    <span className="text-xs text-muted-foreground">from</span>
                                    <div className="relative w-32">
                                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                                        <Input
                                            defaultValue={String(Number(t.minSpend))}
                                            disabled={t.sortOrder === 0}
                                            onBlur={(e) => {
                                                const v = Number(dec(e.target.value));
                                                if (Number.isFinite(v) && v !== Number(t.minSpend)) patchTier(t.id, { minSpend: v });
                                            }}
                                            className="h-8 pl-6 text-right text-xs"
                                        />
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1" title="Discount % at this tier">
                                    <Input
                                        defaultValue={String(Number(t.discountPct))}
                                        onBlur={(e) => {
                                            const v = Number(dec(e.target.value));
                                            if (Number.isFinite(v) && v !== Number(t.discountPct)) patchTier(t.id, { discountPct: v });
                                        }}
                                        className="h-8 w-16 text-right text-xs"
                                    />
                                    <span className="text-xs text-muted-foreground">%</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

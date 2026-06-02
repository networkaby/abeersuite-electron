"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, X, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface GiftCard {
    id: number;
    code: string;
    initialValue: string | number;
    balance: string | number;
    status: "ACTIVE" | "REDEEMED" | "EXPIRED" | "VOID";
    expiresAt: string | null;
    ownerAccount: { name: string } | null;
    createdAt: string;
}

const dec = (s: string): string => s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusTone: Record<GiftCard["status"], string> = {
    ACTIVE:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    REDEEMED: "bg-muted text-muted-foreground",
    EXPIRED:  "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    VOID:     "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

export function GiftCards() {
    const [cards, setCards] = useState<GiftCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [value, setValue] = useState("");
    const [code, setCode] = useState("");
    const [expiresAt, setExpiresAt] = useState("");
    const [issuing, setIssuing] = useState(false);

    function load() {
        axios.get<GiftCard[]>("/api/gift-cards")
            .then((r) => setCards(r.data))
            .catch(() => toast.error("Failed to load gift cards"))
            .finally(() => setLoading(false));
    }
    useEffect(load, []);

    async function issue() {
        const v = Number(value);
        if (!Number.isFinite(v) || v <= 0) return toast.error("Enter a value");
        setIssuing(true);
        try {
            await axios.post("/api/gift-cards", {
                initialValue: v,
                code: code.trim() || undefined,
                expiresAt: expiresAt ? new Date(expiresAt + "T00:00:00").toISOString() : null,
            });
            toast.success("Gift card issued");
            setValue(""); setCode(""); setExpiresAt(""); setShowAdd(false);
            load();
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Failed to issue") : "Failed to issue");
        } finally {
            setIssuing(false);
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="space-y-1.5">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400"><CreditCard size={15} /></span>
                        Gift cards
                    </CardTitle>
                    <CardDescription>
                        Prepaid store credit. Issuing posts Dr Cash / Cr &ldquo;Gift Card Liability&rdquo;; redeeming at POS draws the liability down as a payment tender.
                    </CardDescription>
                </div>
                {!showAdd && (
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => setShowAdd(true)}>
                        <Plus size={14} className="mr-1" /> Issue
                    </Button>
                )}
            </CardHeader>
            <CardContent className="space-y-3">
                {showAdd && (
                    <div className="space-y-3 rounded-lg border border-dashed border-border/70 bg-muted/20 p-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">Issue gift card</span>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowAdd(false)}><X size={14} /></Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                            <div className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">Value</Label>
                                <div className="relative">
                                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                                    <Input inputMode="decimal" value={value} onChange={(e) => setValue(dec(e.target.value))} placeholder="1000" className="h-9 pl-6 text-right" />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">Code (blank = auto)</Label>
                                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="auto" className="h-9 font-mono" />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">Expires (optional)</Label>
                                <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="h-9" />
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <Button size="sm" onClick={issue} disabled={issuing}><Plus size={14} className="mr-1" /> Issue</Button>
                        </div>
                    </div>
                )}

                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : cards.length === 0 && !showAdd ? (
                    <div className="rounded-lg border border-dashed border-border/70 py-8 text-center text-sm text-muted-foreground">
                        No gift cards yet — issue one to sell prepaid store credit.
                    </div>
                ) : (
                    <ul className="divide-y rounded-lg border border-border/60">
                        {cards.map((c) => (
                            <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                                <span className="font-mono text-sm font-semibold">{c.code}</span>
                                <span className="flex-1 text-xs text-muted-foreground tabular-nums">
                                    {fmtINR(Number(c.balance))} <span className="opacity-60">/ {fmtINR(Number(c.initialValue))}</span>
                                    {c.ownerAccount ? ` · ${c.ownerAccount.name}` : ""}
                                    {c.expiresAt ? ` · exp ${c.expiresAt.slice(0, 10)}` : ""}
                                </span>
                                <Badge className={`${statusTone[c.status]} border-0 text-[10px]`}>{c.status}</Badge>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

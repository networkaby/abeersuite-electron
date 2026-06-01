"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Award, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type LedgerRow = {
    id: number;
    delta: number;
    reason: "EARN_SALE" | "REDEEM_SALE" | "REVERSAL_RETURN" | "ADMIN_ADJUST" | "EXPIRY";
    balanceAfter: number;
    note: string | null;
    createdAt: string;
    voucher: { id: number; reference: string } | null;
};
type Lot = { id: number; pointsRemaining: number; pointsEarned: number; earnedAt: string; expiresAt: string };
type Wallet = { balance: number; totalEarned: number; totalRedeemed: number; totalExpired: number; lots: Lot[]; ledger: LedgerRow[] };

const REASON_LABEL: Record<LedgerRow["reason"], string> = {
    EARN_SALE: "Earned", REDEEM_SALE: "Redeemed", REVERSAL_RETURN: "Return reversal", ADMIN_ADJUST: "Adjustment", EXPIRY: "Expired",
};
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const digitsSigned = (s: string) => s.replace(/[^\d-]/g, "").replace(/(?!^)-/g, "");

export function LoyaltyPanel({ accountId, canManage = false }: { accountId: number; canManage?: boolean }) {
    const [wallet, setWallet] = useState<Wallet | null>(null);
    const [loading, setLoading] = useState(true);
    const [deltaStr, setDeltaStr] = useState("");
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        axios
            .get<Wallet>(`/api/loyalty/${accountId}`)
            .then((r) => setWallet(r.data))
            .catch(() => toast.error("Failed to load loyalty wallet"))
            .finally(() => setLoading(false));
    }, [accountId]);
    useEffect(load, [load]);

    async function adjust() {
        const delta = Number(deltaStr);
        if (!Number.isInteger(delta) || delta === 0) return toast.error("Enter a non-zero whole number");
        setSaving(true);
        try {
            await axios.post("/api/loyalty/adjust", { accountId, delta, note: note.trim() || undefined });
            toast.success("Points adjusted");
            setDeltaStr("");
            setNote("");
            load();
        } catch (e) {
            const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? "Failed to adjust") : "Failed to adjust";
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    }

    if (loading || !wallet) return <p className="text-sm text-muted-foreground">Loading loyalty…</p>;

    return (
        <div className="space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Card><CardContent className="p-4">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground"><Award size={14} /> Balance</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums">{wallet.balance}</div>
                </CardContent></Card>
                <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Earned (lifetime)</div><div className="mt-1 text-xl font-medium tabular-nums">{wallet.totalEarned}</div></CardContent></Card>
                <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Redeemed</div><div className="mt-1 text-xl font-medium tabular-nums">{wallet.totalRedeemed}</div></CardContent></Card>
                <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Expired</div><div className="mt-1 text-xl font-medium tabular-nums">{wallet.totalExpired}</div></CardContent></Card>
            </div>

            {/* Admin adjust */}
            {canManage && (
                <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
                    <div className="space-y-1">
                        <label className="text-[11px] text-muted-foreground">Adjust points (±)</label>
                        <Input value={deltaStr} onChange={(e) => setDeltaStr(digitsSigned(e.target.value))} placeholder="e.g. 50 or -20" className="h-8 w-32 text-right text-xs" />
                    </div>
                    <div className="flex-1 space-y-1">
                        <label className="text-[11px] text-muted-foreground">Note (optional)</label>
                        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for adjustment" className="h-8 text-xs" />
                    </div>
                    <Button size="sm" onClick={adjust} disabled={saving}>
                        {Number(deltaStr) < 0 ? <Minus size={14} className="mr-1" /> : <Plus size={14} className="mr-1" />}
                        Apply
                    </Button>
                </div>
            )}

            {/* Expiring lots */}
            {wallet.lots.length > 0 && (
                <div className="space-y-2">
                    <div className="text-sm font-medium">Active points (oldest expire first)</div>
                    <div className="flex flex-wrap gap-2">
                        {wallet.lots.map((l) => (
                            <Badge key={l.id} variant="outline" className="text-[11px]">
                                {l.pointsRemaining} pts · expires {fmtDate(l.expiresAt)}
                            </Badge>
                        ))}
                    </div>
                </div>
            )}

            {/* History */}
            <div className="space-y-2">
                <div className="text-sm font-medium">History</div>
                {wallet.ledger.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No points activity yet.</p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-28">Date</TableHead>
                                <TableHead>Activity</TableHead>
                                <TableHead className="w-24 text-right">Change</TableHead>
                                <TableHead className="w-24 text-right">Balance</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {wallet.ledger.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                                    <TableCell className="text-sm">
                                        {REASON_LABEL[r.reason]}
                                        {r.voucher && <span className="ml-1 text-xs text-muted-foreground">· {r.voucher.reference}</span>}
                                        {r.note && <span className="ml-1 text-xs text-muted-foreground">· {r.note}</span>}
                                    </TableCell>
                                    <TableCell className={`text-right tabular-nums text-sm ${r.delta >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                                        {r.delta >= 0 ? `+${r.delta}` : r.delta}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums text-sm">{r.balanceAfter}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>
        </div>
    );
}

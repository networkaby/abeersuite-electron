"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { ArrowLeft, Loader2, CheckCircle, XCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmt } from "@/utils/constants";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

interface VoucherLine {
    id:          number;
    quantity:    number;
    rate:        number;
    discountPct: number;
    taxRate:     number;
    taxAmount:   number;
    amount:      number;
    product:     { id: number; sku: string; name: string; unit: { code: string } };
}

interface Voucher {
    id:           number;
    reference:    string;
    date:         string;
    description:  string;
    status:       "DRAFT" | "POSTED" | "VOIDED";
    partyName:    string | null;
    partyPhone:   string | null;
    subtotal:     number;
    taxAmount:    number;
    shippingAmt:  number;
    roundOff:     number;
    totalAmount:  number;
    postedAt:     string | null;
    voidedAt:     string | null;
    voidReason:   string | null;
    createdBy:    { name: string };
    createdAt:    string;
    lines:        VoucherLine[];
}

const STATUS_COLORS: Record<string, string> = {
    DRAFT:  "bg-yellow-100 text-yellow-700 border-yellow-200",
    POSTED: "bg-blue-100 text-blue-700 border-blue-200",
    VOIDED: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABEL: Record<string, string> = {
    DRAFT:  "DRAFT",
    POSTED: "FINALISED",
    VOIDED: "VOIDED",
};

export default function EstimateDetailPage() {
    const { id } = useParams<{ id: string }>();
    const [voucher,    setVoucher]    = useState<Voucher | null>(null);
    const [loading,    setLoading]    = useState(true);
    const [finalising, setFinalising] = useState(false);
    const [showVoid,   setShowVoid]   = useState(false);
    const [voidReason, setVoidReason] = useState("");
    const [voiding,    setVoiding]    = useState(false);

    const load = () => {
        setLoading(true);
        axios.get<Voucher>(`/api/inventory/vouchers/${id}`)
            .then((r) => setVoucher(r.data))
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    };

    useEffect(load, [id]);

    // "Finalise" = mark POSTED (no stock change for estimates)
    const finalise = async () => {
        setFinalising(true);
        try {
            await axios.post(`/api/inventory/vouchers/${id}/post`);
            toast.success("Estimate finalised");
            load();
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error : "Failed");
        } finally {
            setFinalising(false);
        }
    };

    const voidVoucher = async () => {
        if (!voidReason.trim()) { toast.error("Reason required"); return; }
        setVoiding(true);
        try {
            await axios.post(`/api/inventory/vouchers/${id}/void`, { reason: voidReason });
            toast.success("Estimate voided");
            setShowVoid(false);
            load();
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error : "Failed to void");
        } finally {
            setVoiding(false);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-muted-foreground" size={32} />
        </div>
    );

    if (!voucher) return <div className="text-center py-24 text-muted-foreground">Not found</div>;

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link href="/office/finance/estimates" className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold font-mono">{voucher.reference}</h1>
                        <span className={`text-xs px-2.5 py-1 border font-medium ${STATUS_COLORS[voucher.status]}`}>
                            {STATUS_LABEL[voucher.status] ?? voucher.status}
                        </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{voucher.description}</p>
                </div>
                <div className="flex gap-2">
                    {voucher.status === "DRAFT" && (
                        <Button onClick={finalise} disabled={finalising} className="bg-blue-600 hover:bg-blue-700 text-white">
                            {finalising ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                            Finalise
                        </Button>
                    )}
                    {voucher.status !== "VOIDED" && (
                        <Button variant="outline" onClick={() => setShowVoid(true)} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                            <XCircle size={14} /> Void
                        </Button>
                    )}
                </div>
            </div>

            {/* Meta */}
            <div className="grid grid-cols-3 gap-4 rounded-lg border border-border bg-card p-5 text-sm shadow">
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Date</p>
                    <p className="font-medium">{new Date(voucher.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>
                </div>
                {voucher.partyName && (
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">Customer</p>
                        <p className="font-medium">{voucher.partyName}</p>
                        {voucher.partyPhone && <p className="text-xs text-muted-foreground">{voucher.partyPhone}</p>}
                    </div>
                )}
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Created by</p>
                    <p className="font-medium">{voucher.createdBy.name}</p>
                    <p className="text-xs text-muted-foreground">{new Date(voucher.createdAt).toLocaleString()}</p>
                </div>
                {voucher.postedAt && (
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">Finalised at</p>
                        <p className="font-medium text-blue-700">{new Date(voucher.postedAt).toLocaleString()}</p>
                    </div>
                )}
                {voucher.voidedAt && (
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">Voided at</p>
                        <p className="font-medium text-destructive">{new Date(voucher.voidedAt).toLocaleString()}</p>
                    </div>
                )}
                {voucher.voidReason && (
                    <div className="col-span-2">
                        <p className="text-xs text-muted-foreground mb-1">Void reason</p>
                        <p className="font-medium text-destructive">{voucher.voidReason}</p>
                    </div>
                )}
            </div>

            {/* Lines */}
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                        <tr>
                            <th className="px-5 py-3 text-left font-medium">#</th>
                            <th className="px-5 py-3 text-left font-medium">Item</th>
                            <th className="px-5 py-3 text-right font-medium">Qty</th>
                            <th className="px-5 py-3 text-right font-medium">Rate</th>
                            <th className="px-5 py-3 text-right font-medium">Disc %</th>
                            <th className="px-5 py-3 text-right font-medium">Tax %</th>
                            <th className="px-5 py-3 text-right font-medium">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {voucher.lines.map((l, i) => (
                            <tr key={l.id} className="border-b last:border-0 hover:bg-muted/40">
                                <td className="px-5 py-3 text-muted-foreground">{i + 1}</td>
                                <td className="px-5 py-3">
                                    <div className="font-medium">{l.product.name}</div>
                                    <div className="text-xs text-muted-foreground font-mono">{l.product.sku} · {l.product.unit.code}</div>
                                </td>
                                <td className="px-5 py-3 text-right font-mono">{Number(l.quantity)}</td>
                                <td className="px-5 py-3 text-right font-mono">₹ {fmt(Number(l.rate))}</td>
                                <td className="px-5 py-3 text-right text-muted-foreground">{Number(l.discountPct) > 0 ? `${Number(l.discountPct)}%` : "—"}</td>
                                <td className="px-5 py-3 text-right text-muted-foreground">{Number(l.taxRate) > 0 ? `${Number(l.taxRate)}%` : "—"}</td>
                                <td className="px-5 py-3 text-right font-mono font-medium">₹ {fmt(Number(l.amount))}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-muted border-t-2 border-border text-sm">
                        <tr>
                            <td colSpan={5} />
                            <td className="px-5 py-2 text-right text-muted-foreground text-xs">Subtotal</td>
                            <td className="px-5 py-2 text-right font-mono">₹ {fmt(Number(voucher.subtotal))}</td>
                        </tr>
                        {Number(voucher.taxAmount) > 0 && (
                            <tr>
                                <td colSpan={5} />
                                <td className="px-5 py-1 text-right text-muted-foreground text-xs">Tax</td>
                                <td className="px-5 py-1 text-right font-mono text-muted-foreground">₹ {fmt(Number(voucher.taxAmount))}</td>
                            </tr>
                        )}
                        {Number(voucher.shippingAmt) > 0 && (
                            <tr>
                                <td colSpan={5} />
                                <td className="px-5 py-1 text-right text-muted-foreground text-xs">Shipping</td>
                                <td className="px-5 py-1 text-right font-mono text-muted-foreground">₹ {fmt(Number(voucher.shippingAmt))}</td>
                            </tr>
                        )}
                        <tr className="border-t border-border">
                            <td colSpan={5} />
                            <td className="px-5 py-3 text-right font-bold">Total</td>
                            <td className="px-5 py-3 text-right font-mono font-bold text-base">₹ {fmt(Number(voucher.totalAmount))}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* Void dialog */}
            <Dialog open={showVoid} onOpenChange={(open) => { if (!open) setShowVoid(false); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Void Estimate</DialogTitle>
                        <DialogDescription>Mark this estimate as voided / cancelled.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label>Reason</Label>
                        <Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={3} placeholder="Reason for voiding..." />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowVoid(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={voidVoucher} disabled={voiding}>
                            {voiding && <Loader2 size={14} className="animate-spin" />} Confirm Void
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

"use client";

import { useEffect, useState, use } from "react";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Loader2, ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt, JOURNAL_STATUS_COLORS } from "@/utils/constants";
import { LifecycleActions } from "@/modules/accountancy/components/LifecycleActions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { useEscapeBack } from "@/shared/hooks/useEscapeBack";

type VoucherDetail = {
    id: number;
    reference: string;
    type: string;
    date: string;
    description: string;
    status: "DRAFT" | "POSTED" | "CANCELLED";
    partyName: string | null;
    partyPhone: string | null;
    partyAddress: string | null;
    subtotal: number;
    taxAmount: number;
    shippingAmt: number;
    roundOff: number;
    totalAmount: number;
    journalEntryId: number | null;
    postedAt: string | null;
    cancelledAt: string | null;
    cancelReason: string | null;
    createdBy: { name: string };
    lines: {
        id: number;
        quantity: number;
        rate: number;
        discountPct: number;
        discountAmt: number;
        taxRate: number;
        taxAmount: number;
        amount: number;
        product: { id: number; sku: string; name: string; unit: { code: string; label: string } };
    }[];
};

export default function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    useEscapeBack();
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canCancel = hasPermissionWithScope(permissions, "inventory:voucher:cancel");
    const canDelete = hasPermissionWithScope(permissions, "inventory:voucher:delete");
    const canHardDelete = hasPermissionWithScope(permissions, "inventory:voucher:hard-delete");

    const [voucher, setVoucher] = useState<VoucherDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);

    const load = () => {
        setLoading(true);
        axios.get<VoucherDetail>(`/api/inventory/vouchers/${id}`)
            .then((r) => setVoucher(r.data))
            .catch(() => toast.error("Failed to load voucher"))
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

    const post = async () => {
        setActing(true);
        try {
            await axios.post(`/api/inventory/vouchers/${id}/post`);
            toast.success("Voucher posted — stock updated");
            load();
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error : "Failed to post");
        } finally { setActing(false); }
    };

    if (loading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>;
    if (!voucher) return <div className="py-20 text-center text-muted-foreground">Voucher not found.</div>;

    return (
        <div className="space-y-6 max-w-4xl">
            {/* Header */}
            <div className="flex items-center gap-3 flex-wrap">
                <Button variant="ghost" size="icon-sm" onClick={() => router.push("/office/inventory/purchases")} aria-label="Back">
                    <ArrowLeft size={16} />
                </Button>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-semibold font-mono">{voucher.reference}</h2>
                        <span className={`text-xs px-2 py-0.5 font-medium rounded ${JOURNAL_STATUS_COLORS[voucher.status]}`}>
                            {voucher.status}
                        </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{voucher.description}</p>
                </div>
                <div className="flex gap-2 items-center">
                    {voucher.status === "DRAFT" && (
                        <Button onClick={post} disabled={acting}>
                            {acting && <Loader2 size={14} className="animate-spin mr-1" />} Post Voucher
                        </Button>
                    )}
                    <LifecycleActions
                        voucher={voucher}
                        apiBasePath={`/api/inventory/vouchers/${id}`}
                        listPath="/office/inventory/purchases"
                        label="Purchase Voucher"
                        canCancel={canCancel}
                        canDelete={canDelete}
                        canHardDelete={canHardDelete}
                        onChanged={load}
                    />
                </div>
            </div>

            {/* Info cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="rounded-lg border border-border bg-card p-3 space-y-0.5">
                    <p className="text-muted-foreground text-xs">Date</p>
                    <p className="font-medium">{new Date(voucher.date).toLocaleDateString()}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-3 space-y-0.5">
                    <p className="text-muted-foreground text-xs">Supplier</p>
                    <p className="font-medium">{voucher.partyName ?? "—"}</p>
                    {voucher.partyPhone && <p className="text-muted-foreground text-xs">{voucher.partyPhone}</p>}
                </div>
                <div className="rounded-lg border border-border bg-card p-3 space-y-0.5">
                    <p className="text-muted-foreground text-xs">Created by</p>
                    <p className="font-medium">{voucher.createdBy.name}</p>
                    {voucher.postedAt && <p className="text-muted-foreground text-xs">Posted {new Date(voucher.postedAt).toLocaleDateString()}</p>}
                </div>
                {voucher.journalEntryId && (
                    <div className="rounded-lg border border-border bg-card p-3 space-y-0.5">
                        <p className="text-muted-foreground text-xs">GL Journal Entry</p>
                        <Link href={`/office/accountancy/journal-entries/${voucher.journalEntryId}`}
                            className="font-medium text-primary flex items-center gap-1 hover:underline">
                            View JE <ExternalLink size={12} />
                        </Link>
                    </div>
                )}
            </div>

            {voucher.cancelReason && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    Cancel reason: {voucher.cancelReason}
                </div>
            )}

            {/* Line items */}
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                        <tr>
                            <th className="px-4 py-3 text-left font-medium">#</th>
                            <th className="px-4 py-3 text-left font-medium">Product</th>
                            <th className="px-4 py-3 text-right font-medium">Qty</th>
                            <th className="px-4 py-3 text-right font-medium">Unit</th>
                            <th className="px-4 py-3 text-right font-medium">Rate (₹)</th>
                            <th className="px-4 py-3 text-right font-medium">Disc %</th>
                            <th className="px-4 py-3 text-right font-medium">Tax %</th>
                            <th className="px-4 py-3 text-right font-medium">Amount (₹)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {voucher.lines.map((l, i) => (
                            <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                                <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                                <td className="px-4 py-3">
                                    <span className="font-mono text-xs text-muted-foreground">{l.product.sku}</span>
                                    <span className="ml-2 font-medium">{l.product.name}</span>
                                </td>
                                <td className="px-4 py-3 text-right font-mono">{Number(l.quantity)}</td>
                                <td className="px-4 py-3 text-right text-muted-foreground">{l.product.unit.code}</td>
                                <td className="px-4 py-3 text-right font-mono">{fmt(Number(l.rate))}</td>
                                <td className="px-4 py-3 text-right text-muted-foreground">{Number(l.discountPct)}%</td>
                                <td className="px-4 py-3 text-right text-muted-foreground">{Number(l.taxRate)}%</td>
                                <td className="px-4 py-3 text-right font-mono font-medium">{fmt(Number(l.amount))}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="border-t-2 border-border bg-muted text-sm">
                        <tr>
                            <td colSpan={6} />
                            <td className="px-4 py-2 text-right text-muted-foreground text-xs">Subtotal</td>
                            <td className="px-4 py-2 text-right font-mono">₹ {fmt(Number(voucher.subtotal))}</td>
                        </tr>
                        {Number(voucher.taxAmount) > 0 && (
                            <tr>
                                <td colSpan={6} />
                                <td className="px-4 py-2 text-right text-muted-foreground text-xs">Tax</td>
                                <td className="px-4 py-2 text-right font-mono">₹ {fmt(Number(voucher.taxAmount))}</td>
                            </tr>
                        )}
                        {Number(voucher.shippingAmt) > 0 && (
                            <tr>
                                <td colSpan={6} />
                                <td className="px-4 py-2 text-right text-muted-foreground text-xs">Shipping</td>
                                <td className="px-4 py-2 text-right font-mono">₹ {fmt(Number(voucher.shippingAmt))}</td>
                            </tr>
                        )}
                        <tr className="border-t border-border font-semibold">
                            <td colSpan={6} />
                            <td className="px-4 py-3 text-right">Total</td>
                            <td className="px-4 py-3 text-right font-mono text-base">₹ {fmt(Number(voucher.totalAmount))}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
}

"use client";
// Shared detail view for the new Tally-style inventory vouchers
// (Sales Order, Purchase Order, GRN, Challan, Stock Journal, Physical Stock,
// Rejection In/Out). Includes the full lifecycle actions strip.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ArrowLeft, CheckCircle, ExternalLink, Pencil, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt, JOURNAL_STATUS_COLORS } from "@/utils/constants";
import { LifecycleActions } from "@/modules/accountancy/components/LifecycleActions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";

type Voucher = {
    id:             number;
    type:           string;
    reference:      string;
    date:           string;
    description:    string;
    status:         "DRAFT" | "POSTED" | "CANCELLED";
    partyName:      string | null;
    partyPhone:     string | null;
    partyAddress:   string | null;
    subtotal:       number;
    totalAmount:    number;
    showPrices:     boolean;
    journalEntryId: number | null;
    postedAt:       string | null;
    cancelledAt:    string | null;
    cancelReason:   string | null;
    deletedAt:      string | null;
    deleteReason:   string | null;
    createdBy:      { name: string };
    createdAt:      string;
    refVoucherId:   number | null;
    refVoucher:     { id: number; reference: string; type: string } | null;
    branch?:        { id: string; name: string } | null;
    lines: {
        id:          number;
        quantity:    number;
        rate:        number;
        amount:      number;
        description: string | null;
        product:     { id: number; sku: string; name: string; unit: { code: string; label: string } };
    }[];
};

// Map each non-GL voucher type to the route segment its detail page lives at.
// Used to render a clickable back-link to the parent voucher (e.g. GRN → PO).
const TYPE_ROUTE: Record<string, string> = {
    SALES_ORDER:     "/vouchers/sales-orders",
    PURCHASE_ORDER:  "/vouchers/purchase-orders",
    GRN:             "/vouchers/grn",
    CHALLAN:         "/vouchers/challans",
    REJECTION_IN:    "/vouchers/rejections-in",
    REJECTION_OUT:   "/vouchers/rejections-out",
    SALE:            "/office/inventory/sales",
    PURCHASE:        "/office/inventory/purchases",
};

export function InvVoucherDetail({ basePath, label }: { basePath: string; label: string }) {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canCancel     = hasPermissionWithScope(permissions, "inventory:voucher:cancel");
    const canDelete     = hasPermissionWithScope(permissions, "inventory:voucher:delete");
    const canHardDelete = hasPermissionWithScope(permissions, "inventory:voucher:hard-delete");

    const [voucher, setVoucher] = useState<Voucher | null>(null);
    const [loading, setLoading] = useState(true);
    const [posting, setPosting] = useState(false);

    const load = () => {
        setLoading(true);
        axios.get<Voucher>(`/api/inventory/vouchers/${id}`)
            .then((r) => setVoucher(r.data))
            .catch(() => toast.error("Failed to load"))
            .finally(() => setLoading(false));
    };
    useEffect(load, [id]);

    const post = async () => {
        setPosting(true);
        try {
            await axios.post(`/api/inventory/vouchers/${id}/post`);
            toast.success(`${label} posted`);
            load();
        } catch (err: unknown) {
            toast.error(axios.isAxiosError(err) ? err.response?.data?.error : "Failed to post");
        } finally { setPosting(false); }
    };

    if (loading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>;
    if (!voucher) return <div className="py-20 text-center text-muted-foreground">Voucher not found.</div>;

    return (
        <div className="space-y-6 max-w-4xl">
            <div className="flex items-center gap-3 flex-wrap">
                <Button variant="ghost" size="icon-sm" onClick={() => router.push(basePath)} aria-label="Back">
                    <ArrowLeft size={16} />
                </Button>
                <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                        <h2 className="text-xl font-semibold font-mono">{voucher.reference}</h2>
                        <span className={`text-xs px-2 py-0.5 font-medium rounded ${JOURNAL_STATUS_COLORS[voucher.status]}`}>
                            {voucher.status}
                        </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{voucher.description}</p>
                </div>
                <div className="flex gap-2 items-center">
                    {voucher.status !== "CANCELLED" && !voucher.deletedAt && (
                        <Button
                            variant="outline"
                            onClick={() => router.push(`${basePath}/new?voucherId=${voucher.id}`)}
                            title="Edit voucher in the rich form"
                        >
                            <Pencil size={14} /> Edit
                        </Button>
                    )}
                    {voucher.status === "DRAFT" && (
                        <Button onClick={post} disabled={posting} className="bg-green-600 hover:bg-green-700 text-white">
                            {posting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Post
                        </Button>
                    )}
                    <LifecycleActions
                        voucher={voucher}
                        apiBasePath={`/api/inventory/vouchers/${id}`}
                        listPath={basePath}
                        label={label}
                        canCancel={canCancel}
                        canDelete={canDelete}
                        canHardDelete={canHardDelete}
                        onChanged={load}
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <Card label="Date">{new Date(voucher.date).toLocaleDateString()}</Card>
                {voucher.branch && (
                    <Card label="Branch">{voucher.branch.name}</Card>
                )}
                {voucher.partyName && (
                    <Card label="Party">
                        {voucher.partyName}
                        {voucher.partyPhone && <p className="text-muted-foreground text-xs">{voucher.partyPhone}</p>}
                    </Card>
                )}
                <Card label="Created by">
                    {voucher.createdBy.name}
                    {voucher.postedAt && <p className="text-muted-foreground text-xs">Posted {new Date(voucher.postedAt).toLocaleDateString()}</p>}
                </Card>
                {voucher.journalEntryId && (
                    <Card label="GL Journal Entry">
                        <Link href={`/office/accountancy/journal-entries/${voucher.journalEntryId}`} className="font-medium text-primary flex items-center gap-1 hover:underline">
                            View JE <ExternalLink size={12} />
                        </Link>
                    </Card>
                )}
            </div>

            {voucher.refVoucher && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm flex items-center gap-2">
                    <Link2 size={14} className="text-primary" />
                    <span className="text-muted-foreground">Linked to</span>
                    <Link
                        href={`${TYPE_ROUTE[voucher.refVoucher.type] ?? basePath}/${voucher.refVoucher.id}`}
                        className="font-mono font-medium text-primary hover:underline"
                    >
                        {voucher.refVoucher.reference}
                    </Link>
                </div>
            )}

            {voucher.cancelReason && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    Cancel reason: {voucher.cancelReason}
                </div>
            )}
            {voucher.deletedAt && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
                    <p className="font-medium text-destructive">Deleted on {new Date(voucher.deletedAt).toLocaleString()}</p>
                    {voucher.deleteReason && <p className="text-destructive/80 mt-1">Reason: {voucher.deleteReason}</p>}
                </div>
            )}

            <div className="overflow-hidden rounded-lg border border-border bg-card shadow">
                <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                        <tr>
                            <th className="px-4 py-3 text-left font-medium">#</th>
                            <th className="px-4 py-3 text-left font-medium">Item</th>
                            <th className="px-4 py-3 text-right font-medium">Qty</th>
                            {voucher.showPrices && (
                                <>
                                    <th className="px-4 py-3 text-right font-medium">Rate</th>
                                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                                </>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {voucher.lines.map((l, i) => (
                            <tr key={l.id} className="border-b last:border-0 hover:bg-muted/40">
                                <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                                <td className="px-4 py-3">
                                    <div className="font-medium">{l.product.name}</div>
                                    <div className="text-xs text-muted-foreground font-mono">{l.product.sku} · {l.product.unit.code}</div>
                                </td>
                                <td className="px-4 py-3 text-right font-mono">{Number(l.quantity)}</td>
                                {voucher.showPrices && (
                                    <>
                                        <td className="px-4 py-3 text-right font-mono">₹ {fmt(Number(l.rate))}</td>
                                        <td className="px-4 py-3 text-right font-mono font-medium">₹ {fmt(Number(l.amount))}</td>
                                    </>
                                )}
                            </tr>
                        ))}
                    </tbody>
                    {voucher.showPrices && (
                        <tfoot className="bg-muted border-t-2 border-border text-sm font-semibold">
                            <tr>
                                <td colSpan={4} className="px-4 py-2 text-right text-muted-foreground">Total</td>
                                <td className="px-4 py-2 text-right font-mono">₹ {fmt(Number(voucher.totalAmount))}</td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-border bg-card p-3 space-y-0.5">
            <p className="text-muted-foreground text-xs">{label}</p>
            <p className="font-medium">{children}</p>
        </div>
    );
}

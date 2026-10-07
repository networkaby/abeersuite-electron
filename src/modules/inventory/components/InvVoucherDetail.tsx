"use client";
// Shared detail view for the new Tally-style inventory vouchers
// (Sales Order, Purchase Order, GRN, Challan, Stock Journal, Physical Stock,
// Rejection In/Out). Includes the full lifecycle actions strip.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import Link from "next/link";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Loader2, ArrowLeft, CheckCircle, ExternalLink, Pencil, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmt } from "@/shared/lib/format/moneyInr";
import { JOURNAL_STATUS_COLORS } from "@/shared/lib/constants/badges";
import { LifecycleActions } from "@/modules/accountancy/components/LifecycleActions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { requiredVoucherPermission } from "@/shared/lib/auth/voucherMatrix";
import { editFormUrl } from "@/modules/inventory/components/VoucherActionsMenu";
import { BillNotifyStatus } from "@/shared/components/BillNotifyStatus";

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
    universalVoucherId?: number | null;
    postedAt:       string | null;
    cancelledAt:    string | null;
    cancelReason:   string | null;
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

// (Local TYPE_ROUTE removed — duplicated VoucherActionsMenu.EDIT_FORM_URLS
//  and contained the now-dead /office/inventory/{sales,purchases} entries.
//  The parent-voucher back-link below now uses editFormUrl() so SALE_RETURN
//  → SALE drills to the editable form, matching the rest of the app.)

export function InvVoucherDetail({ basePath, label, formPath }: {
    /** Register list URL — Lifecycle hard-delete + refVoucher fallback land here. */
    basePath: string;
    label:    string;
    /** Editable form URL prefix. Edit drills into `${formPath}?voucherId=<id>`.
     *  Defaults to `${basePath}/new` for the legacy single-tree pattern. New
     *  vouchers split the register (under accountancy) from the form (under
     *  /vouchers/), so they pass both. */
    formPath?: string;
}) {
    const editPath = formPath ?? `${basePath}/new`;
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const holds = (id: string | null) => id != null && hasPermissionWithScope(permissions, id);

    // Close / back behaviour:
    //   • Same-tab navigation (e.g. Day Book → detail): router.back() returns
    //     to the caller without disturbing any other view.
    //   • New-tab open (opened via window.open or link target=_blank):
    //     history.length === 1, so router.back() is a silent no-op.
    //     window.close() closes the script-opened tab in Chrome/Firefox.
    //   • Manually-typed URL: window.close() silently fails — acceptable.
    const closeDetail = () => {
        if (typeof window === "undefined") return;
        if (window.history.length > 1) {
            router.back();
        } else {
            window.close();
        }
    };

    const [voucher, setVoucher] = useState<Voucher | null>(null);
    const [loading, setLoading] = useState(true);
    const [posting, setPosting] = useState(false);

    const load = (silent = false) => {
        if (!silent) setLoading(true);
        axios.get<Voucher>(`/api/inventory/vouchers/${id}`)
            .then((r) => setVoucher(r.data))
            .catch(() => { if (!silent) toast.error("Failed to load"); })
            .finally(() => { if (!silent) setLoading(false); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => load(), [id]);

    // This voucher can be posted, cancelled or deleted from another screen while
    // it is open here — and the Post button acts on what is on screen. Silent:
    // no spinner over a document the user is reading.
    useRealtimeTopics(["ledger", "stock"], () => { load(true); });

    const post = async () => {
        setPosting(true);
        try {
            await axios.post(`/api/inventory/vouchers/${id}/post`);
            toast.success(`${label} posted`);
            load();
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Failed to post"));
        } finally { setPosting(false); }
    };

    if (loading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>;
    if (!voucher) return <div className="py-20 text-center text-muted-foreground">Voucher not found.</div>;

    // Posting is a separate permission — hide Post on a draft for a create-but-not-
    // post user (matches the route's per-kind post check).
    const canPost       = holds(requiredVoucherPermission(voucher.type, "post"));
    const canCancel     = holds(requiredVoucherPermission(voucher.type, "cancel"));
    const canDelete     = holds(requiredVoucherPermission(voucher.type, "delete"));
    const canHardDelete = canDelete;

    return (
        <div className="space-y-6 max-w-4xl">
            <div className="flex items-center gap-3 flex-wrap">
                <Button variant="ghost" size="icon-sm" onClick={closeDetail} aria-label="Back">
                    <ArrowLeft size={16} />
                </Button>
                <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                        <h2 className="text-xl font-semibold font-mono">{voucher.reference}</h2>
                        <span className={`text-xs px-2 py-0.5 font-medium rounded ${JOURNAL_STATUS_COLORS[voucher.status]}`}>
                            {voucher.status}
                        </span>
                        {voucher.status === "POSTED" && <BillNotifyStatus universalVoucherId={voucher.universalVoucherId} />}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{voucher.description}</p>
                </div>
                <div className="flex gap-2 items-center">
                    {voucher.status !== "CANCELLED" && (
                        <Button
                            variant="outline"
                            onClick={() => router.push(`${editPath}?voucherId=${voucher.id}`)}
                            title="Edit voucher in the rich form"
                        >
                            <Pencil size={14} /> Edit
                        </Button>
                    )}
                    {voucher.status === "DRAFT" && canPost && (
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
                        <Link href={`/vouchers/journal-entries/${voucher.journalEntryId}`} className="font-medium text-primary flex items-center gap-1 hover:underline">
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
                        href={editFormUrl(voucher.refVoucher.type, voucher.refVoucher.id) ?? `${basePath}/${voucher.refVoucher.id}`}
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

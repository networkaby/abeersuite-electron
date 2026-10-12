"use client";

// Read-only look inside one recycle-bin copy (GET /api/audit/[id]) — what a deleted
// voucher held, or what an edit replaced. Three stored shapes reach here:
//   INV_VOUCHER   — VoucherDetail fields + `lines` (goods) + `journalEntry` (spine + GL lines)
//   GL_VOUCHER    — the spine itself, its `lines` being GL lines
//   JOURNAL_ENTRY — older copies, same idea as GL
// Header / Lines / Ledger are laid out from whichever fields are present, and the
// raw copy is always one click away so an audit never depends on the layout.

import { useEffect, useState } from "react";
import axios from "axios";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatDate, formatDateTime } from "@/shared/lib/format/formatDate";
import { formatInr, moneyNumber } from "@/shared/lib/format/moneyInr";
import { voucherTypeLabel } from "@/shared/lib/format/voucherTypeLabel";
import { extractApiError } from "@/shared/lib/api";
import { auditSnapshotKind } from "@/shared/lib/accountancy/auditSnapshotKind";

type Num = number | string | null | undefined;
type Snap = Record<string, unknown> & {
    voucherNo?: string | null; type?: string; date?: string; status?: string;
    description?: string; narration?: string | null;
    partyJson?: { name?: string; phone?: string; address?: string } | null;
    partyAccountId?: number | null;
    refNumber?: string | null; refDate?: string | null;
    subtotal?: Num; taxAmount?: Num; discountAmt?: Num; shippingAmt?: Num; roundOff?: Num; totalAmount?: Num;
    lines?: SnapLine[];
    journalEntry?: (Snap & { lines?: SnapLine[] }) | null;
};
type SnapLine = {
    id?: number; productId?: number; product?: { name?: string } | null; description?: string | null;
    quantity?: Num; freeQty?: Num; rate?: Num; discountAmt?: Num; taxRate?: Num; taxAmount?: Num; amount?: Num;
    accountId?: number; type?: "DEBIT" | "CREDIT"; method?: string | null; reference?: string | null;
};
interface AuditDetail {
    id: number; entityType: string; subtype: string | null; originalRef: string; action: string;
    reason: string | null; createdAt: string; restoredAt: string | null;
    actor: { id: number; name: string } | null;
    snapshot: Snap;
    names: { products: Record<string, string>; accounts: Record<string, string> };
}

// One read per copy for the life of the page — a frozen copy never changes.
const cache = new Map<number, AuditDetail>();

const money = (v: Num) => (v == null || v === "" ? "—" : formatInr(moneyNumber(v)));
const qty = (v: Num) => (v == null || v === "" ? "—" : String(moneyNumber(v)));

export function AuditSnapshotDialog({ auditId, onClose }: { auditId: number | null; onClose: () => void }) {
    // Results land in state keyed by id; the panel reads the one it is showing.
    const [loaded, setLoaded] = useState<Record<number, AuditDetail | { error: string }>>(() => Object.fromEntries(cache));

    useEffect(() => {
        if (auditId == null || cache.has(auditId)) return;
        let live = true;
        axios.get<AuditDetail>(`/api/audit/${auditId}`)
            .then((r) => { cache.set(auditId, r.data); if (live) setLoaded((m) => ({ ...m, [auditId]: r.data })); })
            .catch((e) => { if (live) setLoaded((m) => ({ ...m, [auditId]: { error: extractApiError(e, "Could not open this copy") } })); });
        return () => { live = false; };
    }, [auditId]);

    const entry = auditId != null ? (cache.get(auditId) ?? loaded[auditId]) : undefined;
    const error = entry && "error" in entry ? entry.error : null;
    const data = entry && !("error" in entry) ? entry : null;

    const s = data?.snapshot;
    // Goods lines carry a productId; GL lines carry accountId + DEBIT/CREDIT.
    const goods = (s?.lines ?? []).filter((l) => l.productId != null);
    const gl = data?.entityType === "INV_VOUCHER"
        ? (s?.journalEntry?.lines ?? [])
        : (s?.lines ?? []).filter((l) => l.accountId != null);
    const head: Snap | undefined = data?.entityType === "INV_VOUCHER" ? { ...s?.journalEntry, ...s } : s;
    const productName = (l: SnapLine) => l.product?.name ?? (l.productId != null ? data?.names.products[l.productId] : undefined) ?? `Product #${l.productId}`;
    const accountName = (id?: number | null) => (id != null ? data?.names.accounts[id] ?? `Account #${id}` : "—");
    const drTotal = gl.filter((l) => l.type === "DEBIT").reduce((a, l) => a + moneyNumber(l.amount ?? 0), 0);
    const crTotal = gl.filter((l) => l.type === "CREDIT").reduce((a, l) => a + moneyNumber(l.amount ?? 0), 0);

    return (
        <Dialog open={auditId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="max-h-[92vh] w-[95vw] max-w-[95vw] overflow-y-auto sm:max-w-[min(1400px,95vw)]">
                <DialogHeader>
                    <DialogTitle className="font-mono">{data?.originalRef || "Saved copy"}</DialogTitle>
                    <DialogDescription>
                        {data ? (
                            <>
                                {voucherTypeLabel(data.subtype) ?? data.subtype ?? data.entityType}
                                {" · "}{auditSnapshotKind(data) === "EDIT" ? "copy taken before an edit" : "copy taken when deleted"}
                                {" · "}{data.actor?.name ?? "unknown"} on {formatDateTime(data.createdAt)}
                                {data.restoredAt ? ` · restored ${formatDateTime(data.restoredAt)}` : ""}
                            </>
                        ) : "Read-only — nothing here changes the books."}
                    </DialogDescription>
                </DialogHeader>

                {error ? (
                    <p className="text-sm text-destructive">{error}</p>
                ) : !data || !head ? (
                    <div className="flex h-32 items-center justify-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
                ) : (
                    <div className="space-y-5 text-sm">
                        <section className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border p-3 text-xs sm:grid-cols-3">
                            <Field label="Voucher no." value={head.voucherNo ?? data.originalRef} />
                            <Field label="Date" value={head.date ? formatDate(head.date) : "—"} />
                            <Field label="Status" value={head.status ?? "—"} />
                            <Field label="Party" value={head.partyJson?.name ?? (head.partyAccountId ? accountName(head.partyAccountId) : "—")} />
                            {head.partyJson?.phone && <Field label="Phone" value={head.partyJson.phone} />}
                            {head.refNumber && <Field label="Ref no." value={`${head.refNumber}${head.refDate ? ` · ${formatDate(head.refDate)}` : ""}`} />}
                            {(head.narration || head.description) && <Field label="Narration" value={head.narration || head.description || ""} wide />}
                            {data.reason && <Field label="Reason" value={data.reason} wide />}
                        </section>

                        {goods.length > 0 && (
                            <section>
                                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items</h3>
                                <table className="w-full text-xs">
                                    <thead className="border-b text-muted-foreground">
                                        <tr>
                                            <th className="py-1 text-left font-medium">#</th>
                                            <th className="py-1 text-left font-medium">Item</th>
                                            <th className="py-1 text-right font-medium">Qty</th>
                                            <th className="py-1 text-right font-medium">Rate</th>
                                            <th className="py-1 text-right font-medium">Disc</th>
                                            <th className="py-1 text-right font-medium">GST</th>
                                            <th className="py-1 text-right font-medium">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {goods.map((l, i) => (
                                            <tr key={l.id ?? i}>
                                                <td className="py-1 text-muted-foreground">{i + 1}</td>
                                                <td className="py-1">{productName(l)}{l.description ? <span className="text-muted-foreground"> — {l.description}</span> : null}</td>
                                                <td className="py-1 text-right tabular-nums">{qty(l.quantity)}{moneyNumber(l.freeQty ?? 0) ? ` +${qty(l.freeQty)} free` : ""}</td>
                                                <td className="py-1 text-right tabular-nums">{money(l.rate)}</td>
                                                <td className="py-1 text-right tabular-nums">{moneyNumber(l.discountAmt ?? 0) ? money(l.discountAmt) : "—"}</td>
                                                <td className="py-1 text-right tabular-nums">{moneyNumber(l.taxRate ?? 0) ? `${qty(l.taxRate)}% · ${money(l.taxAmount)}` : "—"}</td>
                                                <td className="py-1 text-right tabular-nums">{money(l.amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="mt-2 ml-auto grid w-64 grid-cols-2 gap-y-0.5 text-xs">
                                    <span className="text-muted-foreground">Subtotal</span><span className="text-right tabular-nums">{money(s?.subtotal)}</span>
                                    {moneyNumber(s?.discountAmt ?? 0) !== 0 && <><span className="text-muted-foreground">Discount</span><span className="text-right tabular-nums">{money(s?.discountAmt)}</span></>}
                                    <span className="text-muted-foreground">GST</span><span className="text-right tabular-nums">{money(s?.taxAmount)}</span>
                                    {moneyNumber(s?.shippingAmt ?? 0) !== 0 && <><span className="text-muted-foreground">Shipping</span><span className="text-right tabular-nums">{money(s?.shippingAmt)}</span></>}
                                    {moneyNumber(s?.roundOff ?? 0) !== 0 && <><span className="text-muted-foreground">Round off</span><span className="text-right tabular-nums">{money(s?.roundOff)}</span></>}
                                    <span className="font-semibold">Total</span><span className="text-right font-semibold tabular-nums">{money(s?.totalAmount)}</span>
                                </div>
                            </section>
                        )}

                        {gl.length > 0 && (
                            <section>
                                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ledger postings</h3>
                                <table className="w-full text-xs">
                                    <thead className="border-b text-muted-foreground">
                                        <tr>
                                            <th className="py-1 text-left font-medium">Account</th>
                                            <th className="py-1 text-left font-medium">Note</th>
                                            <th className="py-1 text-right font-medium">Debit</th>
                                            <th className="py-1 text-right font-medium">Credit</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {gl.map((l, i) => (
                                            <tr key={l.id ?? i}>
                                                <td className="py-1">{accountName(l.accountId)}</td>
                                                <td className="py-1 text-muted-foreground">{[l.method, l.reference, l.description].filter(Boolean).join(" · ") || ""}</td>
                                                <td className="py-1 text-right tabular-nums">{l.type === "DEBIT" ? money(l.amount) : ""}</td>
                                                <td className="py-1 text-right tabular-nums">{l.type === "CREDIT" ? money(l.amount) : ""}</td>
                                            </tr>
                                        ))}
                                        <tr className="font-semibold">
                                            <td className="py-1" colSpan={2}>Total</td>
                                            <td className="py-1 text-right tabular-nums">{formatInr(drTotal)}</td>
                                            <td className="py-1 text-right tabular-nums">{formatInr(crTotal)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </section>
                        )}

                        <details className="rounded-md border">
                            <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">Raw data (everything stored in this copy)</summary>
                            <pre className="max-h-96 overflow-auto border-t bg-muted/40 p-3 text-[11px] leading-snug">{JSON.stringify(data.snapshot, null, 2)}</pre>
                        </details>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
    return (
        <div className={wide ? "col-span-full" : undefined}>
            <span className="text-muted-foreground">{label}: </span>
            <span className="font-medium">{value || "—"}</span>
        </div>
    );
}

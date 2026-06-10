"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Trash2, PackagePlus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

export interface DetailDraw {
    id: number;
    kind: "ALLOCATION" | "DISMISSAL";
    perUnitPaise: number | null;
    quantity: number | null;
    amountPaise: number;
    note: string | null;
    productName: string | null;
    productSku: string | null;
    date: string;
}
export interface AllocationDoc {
    kind: "ALLOCATION" | "DISMISSAL";
    paymentRef: string | null;
    ledgerName: string | null;
    invVoucherRef: string | null;
    date: string;
    draws: DetailDraw[];
}

const rupee = (paise: number | null): string => (paise == null ? "—" : `₹${(paise / 100).toFixed(2)}`);
function rupeesToPaise(s: string): number | null {
    const t = s.trim();
    if (t === "") return null;
    const n = parseFloat(t);
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
}

interface LineEdit { perUnit: string; qty: string; amount: string; note: string }

export function AllocationDetailDialog({
    doc, onClose, onDone,
}: { doc: AllocationDoc | null; onClose: () => void; onDone: () => void }) {
    const open = doc != null;
    const isAlloc = doc?.kind === "ALLOCATION";
    const [lines, setLines] = useState<DetailDraw[]>([]);
    const [edits, setEdits] = useState<Record<number, LineEdit>>({});
    const [saving, setSaving] = useState(false);

    // Seed the editable rows from the document each time it opens.
    useEffect(() => {
        if (!open || !doc) return;
        setLines(doc.draws);
        const e: Record<number, LineEdit> = {};
        for (const d of doc.draws) {
            e[d.id] = {
                perUnit: d.perUnitPaise != null ? (d.perUnitPaise / 100).toFixed(2) : "",
                qty: d.quantity != null ? String(d.quantity) : "",
                amount: (d.amountPaise / 100).toFixed(2),
                note: d.note ?? "",
            };
        }
        setEdits(e);
    }, [open, doc]);

    function setField(id: number, key: keyof LineEdit, val: string) {
        setEdits((p) => ({ ...p, [id]: { ...p[id], [key]: val } }));
    }

    const totalPaise = lines.reduce((s, d) => s + (rupeesToPaise(edits[d.id]?.amount ?? "") ?? 0), 0);

    async function deleteLine(id: number) {
        if (!confirm("Delete this line? The amount returns to the entry's waiting pool.")) return;
        try {
            await axios.delete(`/api/pricing-strategy/costing/draws/${id}`);
            const next = lines.filter((l) => l.id !== id);
            setLines(next);
            onDone();
            if (next.length === 0) onClose();
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Delete failed"));
        }
    }

    async function save() {
        // PATCH each line sequentially (the amount is re-capped server-side against
        // the source entry, so order matters when totals shift).
        setSaving(true);
        try {
            for (const d of lines) {
                const e = edits[d.id];
                if (!e) continue;
                const amountPaise = rupeesToPaise(e.amount);
                if (amountPaise == null || amountPaise <= 0) { toast.error("Each line needs a valid amount."); setSaving(false); return; }
                const body: Record<string, unknown> = { amountPaise, note: e.note.trim() || null };
                if (d.kind === "ALLOCATION") {
                    const pu = rupeesToPaise(e.perUnit);
                    if (pu == null) { toast.error("Each line needs a per-unit value."); setSaving(false); return; }
                    body.perUnitPaise = pu;
                    const q = e.qty.trim() === "" ? null : parseFloat(e.qty);
                    if (q != null && (!isFinite(q) || q < 0)) { toast.error("Quantity must be a number."); setSaving(false); return; }
                    body.quantity = q;
                }
                await axios.patch(`/api/pricing-strategy/costing/draws/${d.id}`, body);
            }
            toast.success("Saved");
            onDone();
            onClose();
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Save failed"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {isAlloc
                            ? <><PackagePlus className="size-4 text-violet-600" /> Allocation</>
                            : <><XCircle className="size-4 text-muted-foreground" /> Dismissal</>}
                        {doc?.invVoucherRef ? <span className="font-mono text-sm">· {doc.invVoucherRef}</span> : null}
                    </DialogTitle>
                    <DialogDescription>
                        {doc ? (
                            <>
                                Payment voucher: <span className="font-mono">{doc.paymentRef ?? "—"}</span>
                                {doc.ledgerName ? <> · {doc.ledgerName}</> : null}
                                {" · "}Source inventory voucher: <span className="font-mono">{doc.invVoucherRef ?? "—"}</span>
                                {" · "}effective {doc.date.slice(0, 10)}
                            </>
                        ) : null}
                    </DialogDescription>
                </DialogHeader>

                <Table>
                    <TableHeader>
                        <TableRow>
                            {isAlloc ? <TableHead className="text-xs">Product</TableHead> : null}
                            {isAlloc ? <TableHead className="text-right text-xs">Per-unit (₹)</TableHead> : null}
                            {isAlloc ? <TableHead className="text-right text-xs">Qty</TableHead> : null}
                            <TableHead className="text-right text-xs">Amount (₹)</TableHead>
                            <TableHead className="text-xs">Note</TableHead>
                            <TableHead className="text-right text-xs" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {lines.map((d) => (
                            <TableRow key={d.id}>
                                {isAlloc ? (
                                    <TableCell className="text-xs">
                                        <div className="font-medium">{d.productName ?? "—"}</div>
                                        {d.productSku ? <div className="text-[10px] text-muted-foreground">{d.productSku}</div> : null}
                                    </TableCell>
                                ) : null}
                                {isAlloc ? (
                                    <TableCell className="text-right">
                                        <Input inputMode="decimal" value={edits[d.id]?.perUnit ?? ""} onChange={(e) => setField(d.id, "perUnit", e.target.value)} className="h-7 w-20 text-right text-xs font-mono ml-auto" />
                                    </TableCell>
                                ) : null}
                                {isAlloc ? (
                                    <TableCell className="text-right">
                                        <Input inputMode="decimal" value={edits[d.id]?.qty ?? ""} onChange={(e) => setField(d.id, "qty", e.target.value)} className="h-7 w-16 text-right text-xs font-mono ml-auto" />
                                    </TableCell>
                                ) : null}
                                <TableCell className="text-right">
                                    <Input inputMode="decimal" value={edits[d.id]?.amount ?? ""} onChange={(e) => setField(d.id, "amount", e.target.value)} className="h-7 w-24 text-right text-xs font-mono ml-auto" />
                                </TableCell>
                                <TableCell>
                                    <Input value={edits[d.id]?.note ?? ""} onChange={(e) => setField(d.id, "note", e.target.value)} className="h-7 w-40 text-xs" />
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Delete line" onClick={() => deleteLine(d.id)}>
                                        <Trash2 className="size-4 text-muted-foreground" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>

                <DialogFooter className="items-center sm:justify-between">
                    <div className="text-xs text-muted-foreground">
                        Total: <span className="font-mono font-semibold text-foreground">{rupee(totalPaise)}</span> across {lines.length} line{lines.length !== 1 ? "s" : ""}
                    </div>
                    <div className="space-x-2">
                        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Close</Button>
                        <Button type="button" onClick={save} disabled={saving || lines.length === 0}>
                            {saving ? "Saving…" : "Save changes"}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

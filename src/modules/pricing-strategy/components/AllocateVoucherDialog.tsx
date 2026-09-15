"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { TableScrollArea } from "@/shared/components/TableScrollArea";
import { SearchableSelect } from "@/shared/components/SearchableSelect";
import { parseRupeesToPaise } from "@/shared/lib/format";

// The pool entry being allocated (subset of the Costing page's PoolEntry).
export interface AllocEntry {
    glLineId: number;
    ledgerName: string;
    reference: string;
    remainingPaise: number;
}

interface VoucherListItem {
    id: number;
    /// Phase 5 5B: cost-pool keys by the spine; the picked voucher's spine id.
    universalVoucherId: number | null;
    reference: string;
    date: string;
    type: string;
    partyName: string | null;
    _count?: { lines: number };
}
interface VoucherLine {
    productId: number;
    quantity: number;
    rate: number;
    name: string;
    sku: string;
}

const rupee = (paise: number): string => `₹${(paise / 100).toFixed(2)}`;
const paiseToStr = (paise: number): string => (paise / 100).toFixed(2);

export function AllocateVoucherDialog({
    entry, onClose, onDone,
}: { entry: AllocEntry | null; onClose: () => void; onDone: () => void }) {
    const open = entry != null;
    const [vouchers, setVouchers] = useState<VoucherListItem[]>([]);
    const [vouchersLoaded, setVouchersLoaded] = useState(false);
    const [voucherId, setVoucherId] = useState<number | null>(null);
    // Phase 5 5B: the picked voucher's UniversalVoucher spine id — cost-pool draws
    // key by the spine now, while the line/detail fetch still uses the InvVoucher id.
    const [voucherUvId, setVoucherUvId] = useState<number | null>(null);
    // The selected voucher's date — the inward date the new price takes effect from.
    const [voucherDate, setVoucherDate] = useState<string | null>(null);
    const [lines, setLines] = useState<VoucherLine[]>([]);
    const [linesLoading, setLinesLoading] = useState(false);
    // Two synced inputs per line (rupee strings): per-unit surcharge and the
    // line draw (amount). Editing one derives the other via the line quantity.
    const [perUnit, setPerUnit] = useState<Record<number, string>>({});
    const [lineAmt, setLineAmt] = useState<Record<number, string>>({});
    const [distAmount, setDistAmount] = useState("");
    const [submitting, setSubmitting] = useState(false);
    // Freight already allocated to THIS inward (earlier legs) per product, so the
    // user can add another leg without double-counting. Sums across legs.
    const [existing, setExisting] = useState<Record<number, { perUnitPaise: number; legs: number }>>({});

    function resetInputs() { setPerUnit({}); setLineAmt({}); }

    // Load the purchase/GRN voucher list lazily on first open.
    useEffect(() => {
        if (!open || vouchersLoaded) return;
        axios.get<VoucherListItem[]>("/api/inventory/vouchers?types=PURCHASE,GRN&status=POSTED")
            .then((r) => { setVouchers(r.data); setVouchersLoaded(true); })
            .catch(() => toast.error("Failed to load vouchers"));
    }, [open, vouchersLoaded]);

    // Reset per-entry state each time a new entry opens.
    useEffect(() => {
        if (open && entry) {
            setVoucherId(null);
            setVoucherUvId(null);
            setVoucherDate(null);
            setLines([]);
            resetInputs();
            setExisting({});
            setDistAmount((entry.remainingPaise / 100).toFixed(2));
        }
    }, [open, entry]);

    // `id` = InvVoucher id (line/detail fetch); `uvId` = its spine id (draws filter).
    const loadVoucherLines = useCallback(async (id: number, uvId: number | null) => {
        setLinesLoading(true);
        try {
            const r = await axios.get(`/api/inventory/vouchers/${id}`);
            const vl: VoucherLine[] = (r.data.lines ?? []).map((l: {
                productId: number; quantity: string | number; rate: string | number;
                product?: { name?: string; sku?: string };
            }) => ({
                productId: l.productId,
                quantity: Number(l.quantity),
                rate: Number(l.rate),
                name: l.product?.name ?? `#${l.productId}`,
                sku: l.product?.sku ?? "",
            })).filter((l: VoucherLine) => l.productId && l.quantity > 0);
            setLines(vl);
            resetInputs();
            // Earlier freight legs already allocated to this same inward (sum per
            // product). Keyed by the spine id now (the `invVoucherId` param carries it).
            try {
                const ex = await axios.get(`/api/pricing-strategy/costing/draws?invVoucherId=${uvId ?? id}`);
                const m: Record<number, { perUnitPaise: number; legs: number }> = {};
                for (const d of ex.data as { kind: string; productId: number | null; perUnitPaise: number | null }[]) {
                    if (d.kind !== "ALLOCATION" || d.productId == null || d.perUnitPaise == null) continue;
                    const cur = m[d.productId] ?? { perUnitPaise: 0, legs: 0 };
                    cur.perUnitPaise += d.perUnitPaise;
                    cur.legs += 1;
                    m[d.productId] = cur;
                }
                setExisting(m);
            } catch { /* non-fatal — hint just won't show */ }
        } catch {
            toast.error("Failed to load voucher items");
        } finally {
            setLinesLoading(false);
        }
    }, []);

    function pickVoucher(id: number | null) {
        const picked = id != null ? vouchers.find((v) => v.id === id) : undefined;
        const uvId = picked?.universalVoucherId ?? null;
        setVoucherId(id);
        setVoucherUvId(uvId);
        setVoucherDate(picked?.date ?? null);
        setLines([]);
        resetInputs();
        setExisting({});
        if (id != null) void loadVoucherLines(id, uvId);
    }

    const voucherOptions = useMemo(
        () => vouchers.map((v) => ({
            value: v.id,
            label: `${v.reference} · ${v.date.slice(0, 10)}${v.partyName ? " · " + v.partyName : ""} · ${v._count?.lines ?? 0} items`,
            searchText: `${v.reference} ${v.partyName ?? ""}`,
        })),
        [vouchers],
    );

    // Edit per-unit → derive line draw (amount = per-unit × qty).
    function editPerUnit(l: VoucherLine, val: string) {
        setPerUnit((p) => ({ ...p, [l.productId]: val }));
        const pu = parseRupeesToPaise(val);
        setLineAmt((a) => ({ ...a, [l.productId]: pu != null ? paiseToStr(Math.round(pu * l.quantity)) : "" }));
    }
    // Edit line draw → derive per-unit (per-unit = amount / qty).
    function editLineAmt(l: VoucherLine, val: string) {
        setLineAmt((a) => ({ ...a, [l.productId]: val }));
        const amt = parseRupeesToPaise(val);
        setPerUnit((p) => ({ ...p, [l.productId]: amt != null && l.quantity > 0 ? paiseToStr(Math.round(amt / l.quantity)) : "" }));
    }

    const drawPaise = useCallback(
        (l: VoucherLine): number => parseRupeesToPaise(lineAmt[l.productId] ?? "") ?? 0,
        [lineAmt],
    );
    const totalPaise = useMemo(
        () => lines.reduce((s, l) => s + drawPaise(l), 0),
        [lines, drawPaise],
    );
    const overBudget = entry != null && totalPaise > entry.remainingPaise;

    // Auto-distribute a target amount across the lines, by value or by qty.
    function distribute(mode: "value" | "qty") {
        const target = parseRupeesToPaise(distAmount);
        if (target == null || target <= 0) return toast.error("Enter an amount to distribute.");
        if (lines.length === 0) return;
        const nextPu: Record<number, string> = {};
        const nextAmt: Record<number, string> = {};
        if (mode === "qty") {
            const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
            if (totalQty <= 0) return;
            const puPaise = Math.floor(target / totalQty); // floor so the sum never exceeds target
            for (const l of lines) {
                nextPu[l.productId] = paiseToStr(puPaise);
                nextAmt[l.productId] = paiseToStr(Math.round(puPaise * l.quantity));
            }
        } else {
            const totalValue = lines.reduce((s, l) => s + l.quantity * l.rate, 0);
            if (totalValue <= 0) return toast.error("Lines have no value — distribute by qty instead.");
            for (const l of lines) {
                const share = target * ((l.quantity * l.rate) / totalValue); // paise
                const puPaise = l.quantity > 0 ? Math.floor(share / l.quantity) : 0;
                nextPu[l.productId] = paiseToStr(puPaise);
                nextAmt[l.productId] = paiseToStr(Math.round(puPaise * l.quantity));
            }
        }
        setPerUnit(nextPu);
        setLineAmt(nextAmt);
    }

    async function submit() {
        if (!entry) return;
        const payloadLines = lines
            .map((l) => {
                const pu = parseRupeesToPaise(perUnit[l.productId] ?? "");
                const amt = parseRupeesToPaise(lineAmt[l.productId] ?? "");
                return pu != null && amt != null && amt > 0
                    ? { productId: l.productId, perUnitPaise: pu, quantity: l.quantity, amountPaise: amt }
                    : null;
            })
            .filter((x): x is NonNullable<typeof x> => x != null);
        if (payloadLines.length === 0) return toast.error("Enter a per-unit cost or line draw for at least one product.");
        if (overBudget) return toast.error(`Total ${rupee(totalPaise)} exceeds the entry's remaining ${rupee(entry.remainingPaise)}.`);
        setSubmitting(true);
        try {
            await axios.post("/api/pricing-strategy/costing/draws/batch", {
                sourceGlLineId: entry.glLineId,
                sourceUniversalVoucherId: voucherUvId ?? undefined,
                // Effective date = the inward voucher's date, so the updated cost
                // takes effect from when the goods (and their freight) came in.
                date: voucherDate ?? undefined,
                lines: payloadLines,
            });
            toast.success(`Allocated to ${payloadLines.length} product${payloadLines.length > 1 ? "s" : ""}`);
            onDone();
            onClose();
        } catch (err: unknown) {
            toast.error(extractApiError(err, "Allocation failed"));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Allocate shipping cost to a purchase</DialogTitle>
                    <DialogDescription>
                        {entry ? (
                            <>
                                {entry.ledgerName} · {entry.reference} · remaining{" "}
                                <span className="font-semibold text-amber-700 dark:text-amber-300">{rupee(entry.remainingPaise)}</span>
                                . Pick the purchase/GRN this courier cost was for, then set each product&apos;s per-unit share
                                <span className="text-muted-foreground"> (or type the line amount directly — the other fills in)</span>.
                            </>
                        ) : null}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Purchase / GRN voucher</label>
                        <SearchableSelect
                            value={voucherId}
                            onChange={pickVoucher}
                            options={voucherOptions}
                            placeholder={vouchersLoaded ? "Search a purchase / GRN…" : "Loading vouchers…"}
                            triggerClassName="h-9 w-full text-sm"
                            ariaLabel="Pick purchase or GRN voucher"
                        />
                    </div>

                    {voucherId != null ? (
                        <>
                            <div className="flex flex-wrap items-end gap-2 rounded-sm border border-border bg-muted/30 p-2">
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Distribute ₹ (before GST)</label>
                                    <Input inputMode="decimal" value={distAmount} onChange={(e) => setDistAmount(e.target.value)} className="h-8 w-32 font-mono text-xs" />
                                </div>
                                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => distribute("value")}>by value</Button>
                                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => distribute("qty")}>by qty</Button>
                                <Button type="button" variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={resetInputs}>clear</Button>
                                <span className="ml-auto text-[11px] text-muted-foreground">
                                    fills per-unit + line draw across lines (rounded down)
                                </span>
                            </div>

                            <TableScrollArea className="max-h-[42vh]">
                                <Table>
                                    <TableHeader className="bg-muted/40 sticky top-0 z-10">
                                        <TableRow>
                                            <TableHead className="text-xs">Product</TableHead>
                                            <TableHead className="text-right text-xs">Qty</TableHead>
                                            <TableHead className="text-right text-xs">Rate</TableHead>
                                            <TableHead className="text-right text-xs">Per-unit add&apos;l (₹)</TableHead>
                                            <TableHead className="text-right text-xs">Line draw (₹)</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {linesLoading ? (
                                            <TableRow><TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">Loading items…</TableCell></TableRow>
                                        ) : lines.length === 0 ? (
                                            <TableRow><TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">This voucher has no stock lines.</TableCell></TableRow>
                                        ) : (
                                            lines.map((l) => (
                                                <TableRow key={l.productId}>
                                                    <TableCell className="text-xs">
                                                        <div className="font-medium">{l.name}</div>
                                                        {l.sku ? <div className="text-[10px] text-muted-foreground">{l.sku}</div> : null}
                                                        {existing[l.productId] ? (
                                                            <div className="text-[10px] text-amber-700 dark:text-amber-300" title="Freight already allocated to this purchase from earlier legs — this new leg adds on top">
                                                                already ₹{(existing[l.productId].perUnitPaise / 100).toFixed(2)}/unit · {existing[l.productId].legs} leg{existing[l.productId].legs !== 1 ? "s" : ""}
                                                            </div>
                                                        ) : null}
                                                    </TableCell>
                                                    <TableCell className="text-right text-xs font-mono">{l.quantity}</TableCell>
                                                    <TableCell className="text-right text-xs font-mono text-muted-foreground">₹{l.rate.toFixed(2)}</TableCell>
                                                    <TableCell className="text-right">
                                                        <Input
                                                            inputMode="decimal"
                                                            placeholder="0.00"
                                                            value={perUnit[l.productId] ?? ""}
                                                            onChange={(e) => editPerUnit(l, e.target.value)}
                                                            className="h-7 w-24 text-right text-xs font-mono ml-auto"
                                                        />
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Input
                                                            inputMode="decimal"
                                                            placeholder="0.00"
                                                            value={lineAmt[l.productId] ?? ""}
                                                            onChange={(e) => editLineAmt(l, e.target.value)}
                                                            className="h-7 w-24 text-right text-xs font-mono ml-auto"
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </TableScrollArea>
                        </>
                    ) : null}
                </div>

                <DialogFooter className="items-center sm:justify-between">
                    <div className="text-xs text-muted-foreground">
                        Total to draw:{" "}
                        <span className={`font-mono font-semibold ${overBudget ? "text-red-600" : "text-foreground"}`}>{rupee(totalPaise)}</span>
                        {entry ? (
                            <>
                                {" · leaves "}
                                <span className={`font-mono font-semibold ${overBudget ? "text-red-600" : "text-amber-700 dark:text-amber-300"}`}>
                                    {rupee(entry.remainingPaise - totalPaise)}
                                </span>
                                {" of "}{rupee(entry.remainingPaise)}{" waiting"}
                            </>
                        ) : null}
                        {overBudget ? <span className="ml-2 text-red-600">over budget</span> : null}
                        <div className="text-[10px]">Pricing-only — never posted to the Day Book / accounts.</div>
                    </div>
                    <div className="space-x-2">
                        <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
                        <Button type="button" onClick={submit} disabled={submitting || totalPaise <= 0 || overBudget}>
                            {submitting ? "Allocating…" : "Allocate"}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

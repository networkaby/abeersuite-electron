"use client";

// One row of the Update & print labels table, and its small chips.
// Moved out of page.tsx unchanged.


import { memo, useState } from "react";
import { gridRowClass, parseDecimalInput } from "@/shared/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { secretDateCode } from "@/modules/inventory/lib/secretDateCode";
import { Check, Clock, RotateCcw, Trash2 } from "lucide-react";

import {
    CostCode,
    COST_METHODS,
    enumFromCode,
    ColKey,
    COL_TINT,
    Row,
    priceWithMargin,
    marginFromPrice,
    strategyRupees,
    profitOf,
    shortDate,
    rupee,
    rowBarcode,
    numOrNull,
    sellingVoice,
    mrpDirty,
    resetRow,
    rowDirty,
    stockQty,
    voiceClass,
    VOICE_NAME,
    tempOrigin,
} from "./labelRowMath";

export const SELLING_TAG = (
    <span className="mb-0.5 flex items-center justify-end gap-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600">
        <Check className="size-2.5" /> lowest
    </span>
);

// The only way to change which column is the lowest price: clicking or typing
// in a box never does (same rule for Computed, Strategy and Sale Price).

// Sits on the same line as "use as lowest" in the origin box — no extra height.
export const ReturnsHere = ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick} title="This price comes back by itself after the next purchase. Click to use it as the lowest now (permanent)." className="mb-0.5 flex w-full items-center justify-end gap-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 hover:text-emerald-600">
        <Clock className="size-2.5" /> after purchase
    </button>
);

export const UseAsLowest = ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick} className="mb-0.5 block w-full text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-emerald-600">
        use as lowest
    </button>
);

export const ProfitSub = ({ p }: { p: { amt: number; pct: number | null } | null }) =>
    p == null ? (
        <span className="block text-[10px] text-muted-foreground">—</span>
    ) : (
        <span className={`block text-[10px] font-mono ${p.amt < 0 ? "text-red-600" : "text-muted-foreground"}`}>
            {rupee(p.amt)}{p.pct != null ? ` · ${p.pct.toFixed(1)}%` : ""}
        </span>
    );

export type RowPersistPatch = { marginPercent?: number | null; mrpPaise?: number | null; costMethod?: string; barcodeManualPaise?: number | null };

// Memoized row — only re-renders when its own `r`, `selected`, or column
// visibility (`hidden`) changes. With ~hundreds of rows this keeps typing in one
// cell from re-rendering the whole table. Requires stable callback props +
// stable `r` references for unchanged rows (setRows keeps them via the ternary).
export const ProductRow = memo(function ProductRow({
    r, index, hidden, selected,
    onUpdate, onPersist, onToggleSel, onRemove, removeTitle,
}: {
    r: Row;
    index: number;
    hidden: Set<ColKey>;
    selected: boolean;
    onUpdate: (id: number, patch: Partial<Row>) => void;
    onPersist: (id: number, patch: RowPersistPatch, opts?: { reload?: boolean }) => void;
    onToggleSel: (id: number) => void;
    onRemove: (id: number) => void;
    /** What the trash button does on this tab — it differs (see `remove`). */
    removeTitle: string;
}) {
    const show = (k: ColKey) => !hidden.has(k);
    const strategyPrice = strategyRupees(r);
    const myPrice = priceWithMargin(r.costIncl, r.margin);
    // While the Computed box is focused it shows exactly what was typed (not the
    // re-derived price, which could drift a paisa from the 2-dp margin).
    const [computedDraft, setComputedDraft] = useState<string | null>(null);
    const savedNum = parseFloat(r.salePrice);
    const savedPrice = isFinite(savedNum) ? savedNum : null;
    const mrpNum = parseFloat(r.mrp);
    const mrp = isFinite(mrpNum) && mrpNum > 0 ? mrpNum : null;
    const bc = rowBarcode(r);
    // Typed text while the box is focused; null = show the saved barcode.
    const [bcDraft, setBcDraft] = useState<string | null>(null);
    // Staff screen shows the real date; the secret code is only for the printed label.
    const dateCode = secretDateCode(r.savedAt);
    const priceDate = shortDate(r.savedAt);
    // Barcode vs the price this row sells at, and the profit % at the barcode price.
    const sellingNow = sellingVoice(r);
    const bcGap = bc.value != null && sellingNow != null ? bc.value - sellingNow : null;
    const bcProfit = profitOf(bc.value, r.costIncl, r.gst);
    const stratProfit = profitOf(strategyPrice, r.costIncl, r.gst);
    const myProfit = profitOf(myPrice, r.costIncl, r.gst);
    const savedProfit = profitOf(savedPrice, r.costIncl, r.gst);
    // Same test the Save button counts with (rowDirty) — a Selling switch with no
    // price edit is an unsaved decision too, and must carry the amber mark.
    const dirty = rowDirty(r);

    return (
        <TableRow className={gridRowClass({ selected, dirty, odd: index % 2 === 1 })}>
            <TableCell>
                <div className="flex items-center gap-1">
                    <Checkbox checked={selected} onCheckedChange={() => onToggleSel(r.id)} aria-label={`Select ${r.name}`} />
                    {/* The amber circle both MARKS the unsaved row and undoes it — one
                        click puts Sale Price + Selling back to the last saved values, so
                        the row drops out of the Save count without any DB call. */}
                    {dirty ? (
                        <button
                            type="button"
                            onClick={() => onUpdate(r.id, resetRow(r))}
                            className="rounded-full p-0.5 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
                            title="Unsaved change — click to reset this row (Computed, Fixed Price, MRP, Public Price + Selling)"
                            aria-label={`Reset ${r.name}`}
                        >
                            <RotateCcw className="size-3.5" />
                        </button>
                    ) : null}
                </div>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
            <TableCell className="max-w-[320px] text-xs font-medium" title={r.sku ? `${r.name} · ${r.sku}` : r.name}>
                <div className="truncate">{r.name}</div>
                {r.sku ? <div className="truncate text-[10px] font-normal text-muted-foreground">{r.sku}</div> : null}
            </TableCell>
            {show("brand") ? <TableCell className="text-xs text-muted-foreground">{r.brand || "—"}</TableCell> : null}
            {show("category") ? <TableCell className="text-xs text-muted-foreground">{r.category || "—"}</TableCell> : null}
            {show("group") ? <TableCell className="text-xs text-muted-foreground">{r.group || "—"}</TableCell> : null}
            {show("stock") ? (
                <TableCell className={`text-right text-xs font-mono ${COL_TINT.stock} ${stockQty(r) <= 0 ? "text-red-600" : ""}`}>
                    {r.stock === "" ? "—" : r.stock}
                </TableCell>
            ) : null}
            {show("cost") ? (
                <TableCell className={`align-top ${COL_TINT.cost}`}>
                    <div className="flex flex-col items-end gap-1">
                        <span className="text-xs font-mono text-muted-foreground">
                            {r.costIncl === "" ? "—" : `₹${r.costIncl}`}
                        </span>
                        {r.additionalExcl > 0 ? (
                            <span
                                className="text-[10px] font-mono text-violet-700 dark:text-violet-300"
                                title="Includes per-unit shipping/courier cost (GST-excl) from the Costing page"
                            >
                                incl +₹{(r.additionalExcl / 100).toFixed(2)} ship
                            </span>
                        ) : null}
                        {/* Native select, not the Radix one: a page holds 150 of these,
                            and a Radix Select per row made mounting and paging slow. */}
                        <select
                            value={r.method}
                            title={COST_METHODS.find((m) => m.code === r.method)?.full}
                            aria-label={`Cost method for ${r.name}`}
                            onChange={(e) => {
                                const v = e.target.value as CostCode;
                                onUpdate(r.id, { method: v });
                                onPersist(r.id, { costMethod: enumFromCode(v) }, { reload: true });
                            }}
                            className="h-6 w-16 cursor-pointer rounded-md border border-input bg-transparent px-1 text-xs font-mono shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30"
                        >
                            {COST_METHODS.map((m) => (
                                <option key={m.code} value={m.code}>{m.code} — {m.full}</option>
                            ))}
                        </select>
                    </div>
                </TableCell>
            ) : null}
            {show("margin") ? (
                <TableCell className={`text-right ${COL_TINT.margin}`}>
                    {/* Read-only: worked out from the price typed in Computed. */}
                    <span className="text-xs font-mono">{r.margin === "" ? "—" : `${r.margin}%`}</span>
                </TableCell>
            ) : null}

            {show("computed") ? (
                <TableCell className={`p-1 text-right align-top ${COL_TINT.computed}`}>
                    <div className={voiceClass(r.saleSource === "MY", false)}>
                        {r.saleSource === "MY" ? SELLING_TAG : tempOrigin(r)?.source === "MY" ? <ReturnsHere onClick={() => onUpdate(r.id, { saleSource: "MY", temp: false, tempCancel: false })} /> : myPrice != null ? <UseAsLowest onClick={() => onUpdate(r.id, { saleSource: "MY", temp: false, tempCancel: false })} /> : null}
                        {/* Type the price; Margin % is derived from it and saved. */}
                        <Input
                            type="text"
                            inputMode="decimal"
                            value={computedDraft ?? (myPrice != null ? myPrice.toFixed(2) : "")}
                            placeholder="—"
                            disabled={!(parseFloat(r.costIncl) > 0)}
                            onFocus={() => { setComputedDraft(myPrice != null ? myPrice.toFixed(2) : ""); }}
                            onChange={(e) => {
                                const v = parseDecimalInput(e.target.value);
                                setComputedDraft(v);
                                onUpdate(r.id, { margin: marginFromPrice(r.costIncl, v) });
                            }}
                            onBlur={() => {
                                setComputedDraft(null);
                            }}
                            className="h-7 w-24 ml-auto text-right text-sm font-mono font-semibold"
                        />
                        <ProfitSub p={myProfit} />
                    </div>
                </TableCell>
            ) : null}

            {show("strategy") ? (
                <TableCell className={`p-1 text-right align-top ${COL_TINT.strategy}`}>
                    <div className={voiceClass(r.saleSource === "STRATEGY", false)}>
                        {r.saleSource === "STRATEGY" ? SELLING_TAG : tempOrigin(r)?.source === "STRATEGY" ? <ReturnsHere onClick={() => onUpdate(r.id, { saleSource: "STRATEGY", temp: false, tempCancel: false })} /> : strategyPrice != null ? <UseAsLowest onClick={() => onUpdate(r.id, { saleSource: "STRATEGY", temp: false, tempCancel: false })} /> : null}
                        <span className="block text-sm font-mono font-semibold">{rupee(strategyPrice)}</span>
                        <ProfitSub p={stratProfit} />
                    </div>
                </TableCell>
            ) : null}

            {show("sale") ? (
                <TableCell className={`p-1 text-right align-top ${COL_TINT.sale}`}>
                    <div className={voiceClass(r.saleSource === "SAVED", false)}>
                        {r.saleSource === "SAVED" ? SELLING_TAG : savedPrice != null ? (
                            // The input itself never flips the voice (typing must not); this link does.
                            <UseAsLowest onClick={() => onUpdate(r.id, { saleSource: "SAVED", temp: false, tempCancel: false })} />
                        ) : null}
                        <div className="relative inline-block">
                            <Input
                                inputMode="decimal"
                                value={r.salePrice}
                                placeholder="—"
                                onChange={(e) => onUpdate(r.id, { salePrice: e.target.value })}
                                className={`h-7 w-24 pl-6 text-right text-xs font-mono font-semibold ${dirty ? "ring-1 ring-amber-400 focus-visible:ring-amber-400" : ""}`}
                            />
                            {/* "Until next purchase" — sits inside the box, takes no height. */}
                            <button
                                type="button"
                                onClick={() => onUpdate(r.id, r.temp
                                    // Off: a saved temp asks the server to restore the original; an unsaved one just undoes.
                                    ? (r.baseTemp ? { temp: false, tempCancel: true } : { temp: false, saleSource: r.baseSource })
                                    // On: Fixed Price sells for now; the original is kept on the server.
                                    : { temp: true, tempCancel: false, saleSource: "SAVED" })}
                                title={r.temp
                                    ? ((o) => `Until next purchase${r.tempSetAt ? ` · set ${new Date(r.tempSetAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
After purchase: back to ${o ? VOICE_NAME[o.source] : "the original"}${o?.fixed ? ` (Fixed Price ₹${o.fixed})` : ""}.
Click to put it back now; "Use as lowest" makes it permanent.`)(tempOrigin(r))
                                    : "Use this Fixed Price until the next purchase — the original price comes back by itself. (\"Use as lowest\" = permanent.)"}
                                aria-pressed={r.temp}
                                className={`absolute left-1 top-1/2 -translate-y-1/2 rounded p-0.5 ${r.temp ? "text-amber-600" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                            >
                                <Clock className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <ProfitSub p={savedProfit} />
                    </div>
                </TableCell>
            ) : null}

            {show("mrp") ? (
                <TableCell className={`text-right ${COL_TINT.mrp}`}>
                    <Input
                        inputMode="decimal"
                        value={r.mrp}
                        placeholder="—"
                        onChange={(e) => onUpdate(r.id, { mrp: e.target.value })}
                        className={`h-7 w-20 text-right text-xs font-mono ${mrpDirty(r) ? "ring-1 ring-amber-400 focus-visible:ring-amber-400" : ""}`}
                    />
                </TableCell>
            ) : null}

            {show("barcode") ? (
                <TableCell className={`text-right align-top ${COL_TINT.barcode}`}>
                    {/* Own input, fully manual: a typed amount is an unsaved change (↺ resets it)
                        until Save prices. Blank = put the saved one back. Nothing moves it on its
                        own — not a Sale Price or MRP change; only this box. */}
                    <div className="flex items-center justify-end gap-1">
                        <Input
                            type="text"
                            inputMode="decimal"
                            value={bcDraft ?? (bc.value != null ? bc.value.toFixed(2) : "")}
                            placeholder="—"
                            title={bc.manual ? "Typed Public Price — only this box changes it" : "Saved Public Price — type to set your own"}
                            onFocus={() => setBcDraft(bc.value != null ? bc.value.toFixed(2) : "")}
                            onChange={(e) => setBcDraft(parseDecimalInput(e.target.value))}
                            onBlur={() => {
                                const typed = bcDraft;
                                setBcDraft(null);
                                if (typed == null) return;
                                let v = numOrNull(typed);
                                if (v != null && mrp != null && v > mrp) v = mrp; // never above MRP
                                if (v != null && v <= 0) v = null;
                                if (v == null) { onUpdate(r.id, { barcodeManual: r.baseBarcode, barcodeIsManual: r.baseBarcodeIsManual }); return; }
                                if (bc.value != null && Math.abs(v - bc.value) < 0.005) return; // unchanged
                                onUpdate(r.id, { barcodeManual: v.toFixed(2), barcodeIsManual: true });
                            }}
                            className={`h-7 w-24 text-right text-sm font-mono font-semibold ${bc.manual ? "border-violet-500 bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200" : ""} ${bc.capped ? "text-amber-600" : ""} ${bc.hint === "m" ? "underline decoration-2 underline-offset-2" : ""}`}
                        />
                    </div>
                    {bcGap != null || bcProfit != null ? (
                        <div
                            className="mt-0.5 text-right font-mono text-[10px] text-muted-foreground"
                            title="Gap = Public Price − lowest price: the room for bargaining and every discount (tier, loyalty, coupon). Red: the Public Price is below the lowest price, so POS has no room — raise the Public Price or lower the lowest. Profit % = after-GST profit if sold at the barcode price (POS bills at the barcode)."
                        >
                            <span className={bcGap != null && bcGap < -0.005 ? "text-red-600" : ""}>
                                {bcGap == null ? "—" : `${bcGap < -0.005 ? "−" : "+"}${rupee(Math.abs(bcGap))}`}
                            </span>
                            {" · "}
                            <span className={bcProfit?.pct != null && bcProfit.pct < 0 ? "text-red-600" : ""}>
                                {bcProfit?.pct != null ? `${bcProfit.pct.toFixed(1)}%` : "—"}
                            </span>
                        </div>
                    ) : null}
                    <div className="mt-0.5 flex justify-end gap-1 text-[10px] text-muted-foreground">
                        {bc.hint && bc.hint !== "m" ? <span>·{bc.hint}</span> : null}
                        {priceDate ? (
                            <span className="rounded bg-muted px-1" title={`Barcode price set on ${r.savedAt} — label code ${dateCode}`}>
                                {priceDate}
                            </span>
                        ) : null}
                    </div>
                </TableCell>
            ) : null}

            <TableCell>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={removeTitle} title={removeTitle} onClick={() => onRemove(r.id)}>
                    <Trash2 className="size-4 text-muted-foreground" />
                </Button>
            </TableCell>
        </TableRow>
    );
});

// ── Page ─────────────────────────────────────────────────────────────────────

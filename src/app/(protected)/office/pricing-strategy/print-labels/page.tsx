"use client";

/**
 * Print Labels — the printing half of the label job, on its own page.
 *
 * Products are added here by search / scan / voucher only; the catalogue browsing
 * and the price editing live next door on Update & print labels. Both pages share
 * ONE queue (src/store/labelPrintStore.ts), so a product ticked there shows up
 * here, and a product scanned here can be re-priced there — same list, two doors.
 *
 * DATA: GET /api/pricing-strategy/items (name, barcode, saved price, MRP, price
 * date, stock) + OrgDefaults.barcodeBandsJson for the printed barcode price.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCanOpenPage } from "@/shared/hooks/useCanOpenPage";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import type { PricingItem } from "@/modules/pricing-strategy/lib/pricingItem";
import { normalizeBarcodeBands, type BarcodeBand } from "@/shared/lib/pricing/barcodePrice";
import { LabelDesigner } from "@/modules/inventory/components/LabelDesigner";
import {
    clampCopies, defaultCopies, localDateOf, pricingItemToLabelItem, todayISO,
    type AddedProduct, type Item as LabelItem,
} from "@/modules/inventory/lib/labelItems";
import { useLabelPrintStore } from "@/store/labelPrintStore";

export default function PrintLabelsPage() {
    const [items, setItems] = useState<PricingItem[]>([]);
    const [bands, setBands] = useState<BarcodeBand[]>([]);
    const [loading, setLoading] = useState(true);

    const ids = useLabelPrintStore((s) => s.ids);
    const copies = useLabelPrintStore((s) => s.copies);
    const incoming = useLabelPrintStore((s) => s.incoming);
    const touched = useLabelPrintStore((s) => s.touched);
    const add = useLabelPrintStore((s) => s.add);
    const remove = useLabelPrintStore((s) => s.remove);
    const setCopies = useLabelPrintStore((s) => s.setCopies);

    // Deep-link: ?fromVoucher=<id> (the GRN/Purchase "Print labels" action).
    const router = useRouter();
    // The Update-prices jump is offered only to someone who may open that page.
    const canOpen = useCanOpenPage();
    const searchParams = useSearchParams();
    const fromVoucher = searchParams.get("fromVoucher");
    const fromVoucherId = fromVoucher && /^\d+$/.test(fromVoucher) ? Number(fromVoucher) : null;

    useEffect(() => {
        let alive = true;
        Promise.all([
            axios.get<PricingItem[]>("/api/pricing-strategy/items"),
            axios.get<{ barcodeBandsJson?: BarcodeBand[] }>("/api/settings/org-defaults"),
        ])
            .then(([itemsRes, odRes]) => {
                if (!alive) return;
                setItems(itemsRes.data);
                setBands(normalizeBarcodeBands(odRes.data.barcodeBandsJson));
            })
            .catch(() => { if (alive) toast.error("Failed to load products."); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);

    // The label queue holds product IDS; the catalogue rows behind them are
    // re-read on `catalogue` / `stock`, so a price or name corrected elsewhere
    // prints correctly without reopening the screen. The queue is untouched.
    useRealtimeTopics(["catalogue", "stock"], () => {
        axios.get<PricingItem[]>("/api/pricing-strategy/items")
            .then((r) => setItems(r.data))
            .catch(() => { /* keep the rows already loaded */ });
    });

    const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

    // Queue → labels, in queue order. Ids the catalogue can't resolve (a product
    // added locally on the other page, never saved) simply don't print.
    const labels = useMemo<LabelItem[]>(() => {
        const today = todayISO();
        return ids.flatMap((id) => {
            const it = itemById.get(id);
            if (!it) return [];
            const priceChanged = touched.includes(id)
                || localDateOf(it.salePriceFrozenAt) === today;
            const count = copies[id] ?? defaultCopies({
                priceChanged,
                stock: it.stock,
                incomingQty: incoming[id],
            });
            return [pricingItemToLabelItem(it, bands, count)];
        });
    }, [ids, itemById, bands, copies, incoming, touched]);

    // Search / scan / voucher adds. The combobox and voucher lines both carry the
    // real product id, so the queue stays in the catalogue's own id space.
    const onAddProducts = useCallback((products: AddedProduct[]) => {
        const queued: number[] = [];
        const incomingQty: Record<number, number> = {};
        const unknown: string[] = [];
        for (const p of products) {
            if (p.id == null) { unknown.push(p.name); continue; }
            queued.push(p.id);
            if (p.incomingQty) incomingQty[p.id] = p.incomingQty;
        }
        if (queued.length) add(queued, { incoming: incomingQty });
        if (unknown.length) toast.error(`Not in the catalogue: ${unknown.join(", ")}`);
    }, [add]);

    return (
        <div className="flex h-full flex-col overflow-y-auto px-4 pt-3 pb-3">
            <LabelDesigner
                items={labels}
                onAddProducts={onAddProducts}
                onRemoveItem={remove}
                onCopiesChange={(id, n) => setCopies(id, clampCopies(n))}
                onUpdateBarcode={canOpen("/office/pricing-strategy/update-print-labels") ? () => router.push("/office/pricing-strategy/update-print-labels?view=selected") : undefined}
                prefillVoucherId={fromVoucherId}
                onPrefillConsumed={() => router.replace("/office/pricing-strategy/print-labels", { scroll: false })}
                pageTitle="Print labels"
                pageSubtitle={loading
                    ? "Loading products…"
                    : "Search, scan, or pick a voucher. Prices and barcodes are set in Update & print labels."}
                rootClassName="pb-10"
            />
        </div>
    );
}

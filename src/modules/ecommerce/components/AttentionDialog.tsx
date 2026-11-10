"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { extractApiError } from "@/shared/lib/api";

// Flag attention (owner, 2026-11-11): park a Draft in the Attention stage with
// the reason — work blocked until something is checked by hand. One box for a
// row, ticked rows and the product page. It leaves by Save as draft / ready.

const QUICK_REASONS = ["Photo wrong", "Data mismatch", "Price doubt", "Name / model wrong", "Duplicate product"];

/** Park Draft products in Attention — POST /api/ecommerce/products/attention. */
async function parkInAttention(ids: number[], reason: string): Promise<boolean> {
    try {
        const { data } = await axios.post<{ parked: number; skipped: string[] }>("/api/ecommerce/products/attention", { ids, reason });
        toast.success(`${data.parked} parked in Attention`);
        if (data.skipped.length) toast.info(`${data.skipped.length} skipped — only Draft products can be flagged (${data.skipped.slice(0, 3).join(", ")}${data.skipped.length > 3 ? ", …" : ""})`);
        return data.parked > 0;
    } catch (e: unknown) {
        toast.error(extractApiError(e, "Could not park in Attention"));
        return false;
    }
}

export function AttentionDialog({
    ids,
    onClose,
    onDone,
}: {
    /** Products to flag; null = closed. */
    ids: number[] | null;
    onClose: () => void;
    onDone: (reason: string) => void;
}) {
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const save = async () => {
        if (!ids || !reason.trim()) return;
        setBusy(true);
        const ok = await parkInAttention(ids, reason.trim());
        setBusy(false);
        if (ok) {
            setReason("");
            onDone(reason.trim());
            onClose();
        }
    };
    return (
        <Dialog open={!!ids} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Flag attention{ids && ids.length > 1 ? ` — ${ids.length} products` : ""}</DialogTitle>
                    <DialogDescription>
                        Why is the work stopped? It is parked in the Attention tab, off the shop, until someone checks it and saves it as draft or ready.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap gap-1.5">
                    {QUICK_REASONS.map((r) => (
                        <Button key={r} type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReason((x) => (x.trim() ? `${x.trim()} — ${r}` : r))}>
                            {r}
                        </Button>
                    ))}
                </div>
                <Textarea
                    autoFocus
                    rows={3}
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Name and photo not matching — verify the unit in the warehouse"
                />
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button disabled={busy || !reason.trim()} onClick={() => void save()}>
                        {busy ? "Saving…" : "Park in Attention"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

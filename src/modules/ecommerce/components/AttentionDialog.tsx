"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { extractApiError } from "@/shared/lib/api";

// Needs attention (owner, 2026-11-11): one reason box for a single row, ticked
// rows and the product page. Resolve clears it without the box (setAttention).

const QUICK_REASONS = ["Photo wrong", "Data mismatch", "Price doubt", "Name / model wrong", "Duplicate product"];

/** Flag (reason) or Resolve (null) — POST /api/ecommerce/products/attention. */
export async function setAttention(ids: number[], reason: string | null): Promise<boolean> {
    try {
        const { data } = await axios.post<{ count: number }>("/api/ecommerce/products/attention", { ids, reason });
        toast.success(reason ? `${data.count} sent to Attention` : `${data.count} resolved`);
        return true;
    } catch (e: unknown) {
        toast.error(extractApiError(e, "Could not update attention"));
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
        const ok = await setAttention(ids, reason.trim());
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
                    <DialogTitle>Needs attention{ids && ids.length > 1 ? ` — ${ids.length} products` : ""}</DialogTitle>
                    <DialogDescription>
                        What is wrong? It waits in the Attention tab until someone fixes it and presses Resolve.
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
                    placeholder="e.g. Photo shows 256GB, name says 128GB"
                />
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button disabled={busy || !reason.trim()} onClick={() => void save()}>
                        {busy ? "Saving…" : "Send to Attention"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

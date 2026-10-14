"use client";

// Remove link popup — the undo of `BillLinkDialog`.
//
// Lists every bill-wise link this voucher takes part in, whichever side it sits
// on, with a Remove per line and Remove all. Removing a link touches neither
// voucher: only the statement "this money belonged to that bill" goes, and both
// ends go back to Due / Partial, ready to be linked again.
//
// Opened by right-clicking a Settled / Partial chip (or left-clicking a Settled
// one, which has nothing else to do). The server gates each removal at `cancel`
// on both voucher kinds, same rung as making the link.

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Unlink } from "lucide-react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { extractApiError } from "@/shared/lib/api";
import { fmt } from "@/shared/lib/format/moneyInr";
import { formatDate } from "@/shared/lib/format/formatDate";

type LinkRow = {
    id:     number;
    amount: number;
    other:  { id: number; type: string; voucherNo: string | null; date: string } | null;
    live:   boolean;
};

export function BillUnlinkDialog({ open, onOpenChange, voucherId, reference, onSaved }: {
    open:         boolean;
    onOpenChange: (v: boolean) => void;
    /** Spine id of the voucher whose links are listed. */
    voucherId:    number;
    reference?:   string;
    /** Called after at least one link was removed. */
    onSaved:      () => void;
}) {
    const [links, setLinks] = useState<LinkRow[] | null>(null);
    const [busy, setBusy] = useState<number | "all" | null>(null);
    const [removedAny, setRemovedAny] = useState(false);

    const load = useCallback(async () => {
        try {
            const { data } = await axios.get<LinkRow[]>("/api/accountancy/allocations", { params: { voucherId } });
            setLinks(data);
        } catch (e) {
            toast.error(extractApiError(e, "Could not load the links"));
            setLinks([]);
        }
    }, [voucherId]);

    useEffect(() => { if (open) void load(); }, [open, load]);

    const close = () => {
        onOpenChange(false);
        if (removedAny) onSaved();
    };

    const remove = async (ids: number[], tag: number | "all") => {
        setBusy(tag);
        let done = 0;
        try {
            for (const id of ids) {
                await axios.delete(`/api/accountancy/allocations/${id}`);
                done++;
            }
            toast.success(done === 1 ? "Link removed." : `${done} links removed.`);
        } catch (e) {
            toast.error(extractApiError(e, "Could not remove the link"));
        } finally {
            if (done > 0) setRemovedAny(true);
            setBusy(null);
            void load();
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Remove link</DialogTitle>
                    <DialogDescription>
                        {reference ? `${reference} is linked to the bills below.` : "This voucher is linked to the bills below."}
                        {" "}Removing a link changes neither voucher — both go back to open, ready to link again.
                    </DialogDescription>
                </DialogHeader>

                {links === null ? (
                    <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
                ) : links.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">No links left on this voucher.</p>
                ) : (
                    <div className="overflow-hidden rounded-md border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/60 text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Voucher</th>
                                    <th className="px-3 py-2 text-left font-medium">Date</th>
                                    <th className="px-3 py-2 text-right font-medium">Linked</th>
                                    <th className="w-24" />
                                </tr>
                            </thead>
                            <tbody>
                                {links.map((l) => (
                                    <tr key={l.id} className="border-t">
                                        <td className="px-3 py-2">
                                            <span className="font-mono text-xs">{l.other?.voucherNo ?? `#${l.other?.id ?? "?"}`}</span>
                                            <span className="ml-2 text-xs text-muted-foreground">
                                                {l.other ? l.other.type.replace(/_/g, " ").toLowerCase() : "deleted"}
                                                {!l.live && " · not counted"}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-xs text-muted-foreground">{l.other ? formatDate(l.other.date) : "—"}</td>
                                        <td className="px-3 py-2 text-right font-mono text-xs">{fmt(l.amount)}</td>
                                        <td className="px-3 py-2 text-right">
                                            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void remove([l.id], l.id)}>
                                                {busy === l.id ? <Loader2 className="size-3 animate-spin" /> : <Unlink className="size-3" />}
                                                Remove
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <DialogFooter>
                    {links && links.length > 1 && (
                        <Button variant="destructive" disabled={busy !== null} onClick={() => void remove(links.map((l) => l.id), "all")}>
                            {busy === "all" && <Loader2 className="size-3 animate-spin" />}
                            Remove all links
                        </Button>
                    )}
                    <Button variant="outline" onClick={close}>Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

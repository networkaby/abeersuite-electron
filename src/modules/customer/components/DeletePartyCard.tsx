"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Trash2, RotateCcw } from "lucide-react";
import { extractApiError } from "@/shared/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

type PartyKind = "person" | "company";

interface Props {
    party: { type: PartyKind; id: number; name: string };
    /** Current status — an inactive party gets a Reactivate card instead of Delete. */
    isActive: boolean;
    canDelete: boolean;
    /** Called after the API decides the outcome — remove/grey the row, close the detail, show a toast. */
    onDeleted: (outcome: "deleted" | "deactivated") => void;
    /** Called after a successful reactivate. */
    onReactivated: () => void;
}

// Delete a Person/Company (or reactivate one already marked inactive). The
// API decides the delete outcome: a party with no posted ledger activity and
// no balance is hard-deleted outright; anything else is kept (isActive: false)
// so vouchers/reports never dangle a reference.
export default function DeletePartyCard({ party, isActive, canDelete, onDeleted, onReactivated }: Props) {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [reactivating, setReactivating] = useState(false);

    if (!canDelete) return null;

    const url = party.type === "person" ? `/api/person/${party.id}` : `/api/companies/${party.id}`;

    const doDelete = async () => {
        setDeleting(true);
        try {
            const res = await axios.delete<{ outcome: "deleted" | "deactivated" }>(url);
            toast.success(
                res.data.outcome === "deleted"
                    ? `${party.name} deleted`
                    : `${party.name} has transactions — marked inactive instead`,
            );
            setConfirmOpen(false);
            onDeleted(res.data.outcome);
        } catch (e) {
            toast.error(extractApiError(e, "Could not delete"));
        } finally {
            setDeleting(false);
        }
    };

    const doReactivate = async () => {
        setReactivating(true);
        try {
            await axios.put(url, { isActive: true });
            toast.success(`${party.name} reactivated`);
            onReactivated();
        } catch (e) {
            toast.error(extractApiError(e, "Could not reactivate"));
        } finally {
            setReactivating(false);
        }
    };

    if (!isActive) {
        return (
            <Card className="border-amber-500/30">
                <CardContent className="space-y-2 pt-4">
                    <div className="flex items-center gap-2">
                        <RotateCcw size={15} className="text-amber-600 dark:text-amber-400" />
                        <p className="text-xs font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">
                            Inactive {party.type}
                        </p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        This {party.type} is marked inactive and hidden from the default list. Reactivate
                        it to bring it back.
                    </p>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={reactivating}
                        onClick={() => void doReactivate()}
                    >
                        <RotateCcw size={14} /> {reactivating ? "Reactivating…" : `Reactivate ${party.type}`}
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-destructive/30">
            <CardContent className="space-y-2 pt-4">
                <div className="flex items-center gap-2">
                    <Trash2 size={15} className="text-destructive" />
                    <p className="text-xs font-semibold uppercase tracking-widest text-destructive">
                        Delete {party.type}
                    </p>
                </div>
                <p className="text-sm text-muted-foreground">
                    If this {party.type} has no transactions and no ledger balance, it&apos;s removed
                    completely. Otherwise it&apos;s kept and marked inactive instead.
                </p>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setConfirmOpen(true)}
                >
                    <Trash2 size={14} /> Delete {party.type}
                </Button>
            </CardContent>

            <Dialog open={confirmOpen} onOpenChange={(o) => !deleting && setConfirmOpen(o)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Delete {party.name}?</DialogTitle>
                        <DialogDescription>
                            If this {party.type}&apos;s ledger has no transactions and no balance, it&apos;s
                            deleted for good — contacts, links, and the empty ledger go with it. If it has
                            a transaction or a balance, it&apos;s kept and marked inactive instead so the
                            books stay intact.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" variant="outline" disabled={deleting} onClick={() => setConfirmOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="button" variant="destructive" disabled={deleting} onClick={() => void doDelete()}>
                            {deleting ? "Deleting…" : "Delete"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

"use client";

// ── ShiftOpenDialog ──────────────────────────────────────────────────────────
// Modal shown by PosScreen when no OPEN shift exists for the current user in
// the active branch. Cashier enters the opening cash float (default ₹2000)
// and the dialog POSTs to /api/pos/shifts. On success, calls `onOpened` so
// PosScreen can switch to ActiveShiftBar without a hard reload.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Wallet } from "lucide-react";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type OpenedShift = {
    id: number;
    tillAccount: { id: number; name: string };
    branch:      { id: string; name: string };
    openingFloatPaise: string;
};

export function ShiftOpenDialog({
    open, onOpenChange, onOpened, tillAccountName,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpened: (shift: OpenedShift) => void;
    tillAccountName: string | null;
}) {
    const [openingFloat, setOpeningFloat] = useState("2000");                     // rupees
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const submit = async () => {
        const rupees = parseFloat(openingFloat) || 0;
        if (rupees < 0) { toast.error("Opening float can't be negative"); return; }
        if (!tillAccountName) {
            toast.error("You don't have a till assigned. Ask an admin to set one on your user profile.");
            return;
        }
        setSubmitting(true);
        try {
            const { data } = await axios.post<OpenedShift>("/api/pos/shifts", {
                openingFloatPaise: Math.round(rupees * 100),
                notes:             notes.trim() || undefined,
            });
            toast.success(`Shift opened with ₹${rupees.toFixed(2)} float`);
            onOpened(data);
            onOpenChange(false);
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
            toast.error(msg ?? "Failed to open shift");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Wallet size={18} className="text-primary" /> Open POS shift
                    </DialogTitle>
                    <DialogDescription>
                        Count the cash you start with and enter it as the opening float. This becomes a
                        Contra from your branch&apos;s vault into your till.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                        <div className="text-xs text-muted-foreground">Your till account</div>
                        <div className="font-medium">{tillAccountName ?? <span className="text-destructive">Not assigned — contact admin</span>}</div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="opening-float">Opening cash float (₹)</Label>
                        <Input
                            id="opening-float"
                            type="text"
                            inputMode="decimal"
                            value={openingFloat}
                            onChange={(e) => setOpeningFloat(e.target.value.replace(/[^\d.]/g, ""))}
                            placeholder="2000"
                            autoFocus
                        />
                        <p className="text-xs text-muted-foreground">Loose change you start the day with. Skip (₹0) if you brought no float.</p>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="open-notes">Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                        <Textarea
                            id="open-notes"
                            rows={2}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="e.g. Morning shift, Wednesday rush expected"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                    <Button onClick={submit} disabled={submitting || !tillAccountName} className="bg-primary">
                        {submitting && <Loader2 size={14} className="animate-spin" />} Open shift
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

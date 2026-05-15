"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Wrench, X } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
    PartySearchAndCreate,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";

interface QuickTicketDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called after a ticket is successfully created. */
    onCreated?: (ticketId: string) => void;
}

interface CreatedTicket {
    id: string;
    deviceId?: number;
}

/**
 * Smallest possible "Customer dropped off a device" form.
 *
 * Reuses {@link PartySearchAndCreate} for the customer step (search by name
 * / phone, or create a new person+optional company in the same control).
 * Heavier ticket fields (priority, warranty, est. cost, pipeline, source
 * shop order, etc.) are intentionally NOT here — full ticket page handles
 * those. POSTs to `/api/tickets`.
 */
export default function QuickTicketDialog({
    open,
    onOpenChange,
    onCreated,
}: QuickTicketDialogProps) {
    const [picked, setPicked] = useState<PickedParty | null>(null);
    const [deviceType, setDeviceType] = useState("");
    const [brand, setBrand] = useState("");
    const [model, setModel] = useState("");
    const [problem, setProblem] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // Reset form whenever the dialog opens fresh.
    useEffect(() => {
        if (open) {
            setPicked(null);
            setDeviceType("");
            setBrand("");
            setModel("");
            setProblem("");
            setSubmitting(false);
        }
    }, [open]);

    const canSubmit =
        picked !== null &&
        deviceType.trim().length > 0 &&
        brand.trim().length > 0 &&
        model.trim().length > 0 &&
        problem.trim().length > 0 &&
        !submitting;

    async function submit() {
        if (!canSubmit || !picked) return;
        setSubmitting(true);
        try {
            // Pick the right party-id field. Company takes precedence.
            const partyFields =
                picked.kind === "company"
                    ? { companyId: picked.id }
                    : { personId: picked.id };

            const { data } = await axios.post<CreatedTicket>("/api/tickets", {
                ...partyFields,
                billingAccountId: picked.accountId ?? undefined,
                deviceType: deviceType.trim(),
                brand: brand.trim(),
                model: model.trim(),
                problem: problem.trim(),
            });

            toast.success(`Ticket ${data.id} created`);
            onCreated?.(data.id);
            onOpenChange(false);
        } catch (err: unknown) {
            const message = axios.isAxiosError(err)
                ? (err.response?.data as { error?: string })?.error ??
                  err.message
                : "Could not create ticket";
            toast.error(message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Wrench size={18} className="text-orange-600" />
                        New repair ticket
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Step 1 — customer */}
                    <div className="space-y-1.5">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            1. Customer
                        </Label>
                        {picked ? (
                            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                                <div className="min-w-0">
                                    <div className="truncate font-medium">
                                        {picked.name}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        {picked.kind === "company" ? "Company" : "Person"}
                                        {picked.phone ? ` · ${picked.phone}` : ""}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setPicked(null)}
                                    className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                                    title="Pick a different customer"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ) : (
                            <PartySearchAndCreate
                                onPicked={setPicked}
                                autoFocus
                                placeholder="Search customer by name or phone…"
                                partyGroup="Sundry Debtors"
                            />
                        )}
                    </div>

                    {/* Step 2 — device + problem */}
                    <div className="space-y-3">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            2. Device & problem
                        </Label>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                    Type *
                                </Label>
                                <Input
                                    value={deviceType}
                                    onChange={(e) => setDeviceType(e.target.value)}
                                    placeholder="Laptop"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                    Brand *
                                </Label>
                                <Input
                                    value={brand}
                                    onChange={(e) => setBrand(e.target.value)}
                                    placeholder="ASUS"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                    Model *
                                </Label>
                                <Input
                                    value={model}
                                    onChange={(e) => setModel(e.target.value)}
                                    placeholder="X515"
                                />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">
                                Problem *
                            </Label>
                            <Textarea
                                value={problem}
                                onChange={(e) => setProblem(e.target.value)}
                                placeholder="What's wrong?"
                                rows={3}
                            />
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        disabled={submitting}
                    >
                        Cancel
                    </Button>
                    <Button onClick={submit} disabled={!canSubmit}>
                        {submitting ? "Creating…" : "Create ticket"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

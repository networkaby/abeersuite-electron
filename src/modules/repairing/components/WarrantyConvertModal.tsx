"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toDateInput } from "@/shared/lib/format";

interface Props {
    ticketId: number; isWarranty: boolean; warrantyStatus: string;
    warrantyRef?: string | null; purchaseDate?: string | null; onClose: () => void;
}

const VOID_REASONS = [
    { value: "physical_damage", label: "Physical damage" },
    { value: "water_damage", label: "Water / liquid damage" },
    { value: "tampered", label: "Tampered / seals broken" },
    { value: "expired", label: "Warranty expired" },
    { value: "third_party_repair", label: "Prior third-party repair" },
    { value: "misuse", label: "Misuse / user error" },
    { value: "other", label: "Other" },
];

export default function WarrantyConvertModal({ ticketId, isWarranty, warrantyStatus, warrantyRef: initRef, purchaseDate: initDate, onClose }: Props) {
    const [voiding, setVoiding] = useState(false);
    const [voidReason, setVoidReason] = useState("");
    const [note, setNote] = useState("");
    const [warrantyRef, setWarrantyRef] = useState(initRef ?? "");
    const [purchaseDate, setPurchaseDate] = useState(toDateInput(initDate ?? null));
    const [saving, setSaving] = useState(false);

    const toWarranty = !isWarranty || (isWarranty && warrantyStatus === "VOID");
    const isVoidAction = isWarranty && warrantyStatus !== "VOID" && voiding;

    const handleSubmit = async () => {
        if (isVoidAction && !voidReason) { toast.error("Select a void reason"); return; }
        setSaving(true);
        try {
            await axios.post(`/api/tickets/${ticketId}/warranty`, {
                isWarranty: isVoidAction ? true : toWarranty,
                warrantyStatus: isVoidAction ? "VOID" : (toWarranty ? "CLAIMED" : "NONE"),
                voidReason: isVoidAction ? voidReason : null,
                note: note || null,
                warrantyRef: warrantyRef || null,
                purchaseDate: purchaseDate || null,
            });
            toast.success(isVoidAction ? "Warranty voided" : toWarranty ? "Converted to warranty" : "Converted to non-warranty");
            onClose();
        } catch { toast.error("Failed to update warranty status"); }
        finally { setSaving(false); }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader className="flex-row items-center justify-between space-y-0">
                    <DialogTitle>Warranty Conversion</DialogTitle>
                    <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground"><X size={20} /></Button>
                </DialogHeader>
                <div className="space-y-4">
                    {isWarranty && warrantyStatus !== "voided" && (
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <Button type="button" onClick={() => setVoiding(false)} variant={!voiding ? "default" : "outline"}
                                className="w-full">
                                Remove from warranty
                            </Button>
                            <Button type="button" onClick={() => setVoiding(true)} variant={voiding ? "default" : "outline"}
                                className="w-full">
                                Void warranty
                            </Button>
                        </div>
                    )}

                    <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground">
                        {isVoidAction
                            ? "Warranty will be voided. Sub-status will switch to SS36 — customer approval required."
                            : toWarranty
                            ? "Ticket will be flagged as warranty claim. Sub-status will switch to SS37 — notify customer no charge."
                            : "Warranty flag will be removed. Any warranty-only sub-status steps will be cleared."}
                    </div>

                    {isVoidAction && (
                        <div>
                            <Label className="mb-1 block">Void reason</Label>
                            <Select value={voidReason} onValueChange={setVoidReason}>
                                <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
                                <SelectContent>
                                    {VOID_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {toWarranty && !isVoidAction && (
                        <>
                            <div>
                                <Label className="mb-1 block">
                                    Warranty ref / serial <span className="text-muted-foreground">(optional)</span>
                                </Label>
                                <Input value={warrantyRef} onChange={(e) => setWarrantyRef(e.target.value)}
                                    placeholder="e.g. SN-12345 or receipt number" />
                            </div>
                            <div>
                                <Label className="mb-1 block">
                                    Purchase date <span className="text-muted-foreground">(optional)</span>
                                </Label>
                                <TallyDateInput value={purchaseDate} onValueChange={setPurchaseDate} />
                            </div>
                        </>
                    )}

                    <div>
                        <Label className="mb-1 block">Note <span className="text-muted-foreground">(optional)</span></Label>
                        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                            placeholder="Add context for the log..."
                            className="resize-none" />
                    </div>

                    <DialogFooter className="pt-1">
                        <Button onClick={onClose} variant="outline" className="flex-1">Cancel</Button>
                        <Button onClick={handleSubmit} disabled={saving} className="flex-1">
                            {saving ? "Saving..." : "Confirm"}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}

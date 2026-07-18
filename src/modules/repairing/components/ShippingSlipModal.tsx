"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { PartySearchAndCreate, type PickedParty } from "@/shared/components/PartySearchAndCreate";

interface DeviceInfo { type: string; brand: string; model: string; problem: string; }

interface Props {
    ticketId: number;
    device: DeviceInfo;
    onClose: () => void;
    onSaved: () => void;
}

// Send-to-service shipping slip. The service centre is a Sundry-Creditor party
// (picked/created via the shared party widget); device details are pre-filled
// from the ticket and editable. On save we persist a snapshot on the ticket and
// open the printable A5 slip. Print-only — it never changes the ticket status;
// the Sending / Waiting / Getting-back stages are configured as normal statuses.
export default function ShippingSlipModal({ ticketId, device, onClose, onSaved }: Props) {
    const [party, setParty] = useState<{ accountId: number; name: string } | null>(null);
    const [form, setForm] = useState({
        type: device.type ?? "",
        brand: device.brand ?? "",
        model: device.model ?? "",
        problem: device.problem ?? "",
        ref: "",
        accessories: "",
        condition: "",
        notes: "",
    });
    const [saving, setSaving] = useState(false);

    const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

    const onPicked = (p: PickedParty) => {
        if (p.accountId == null) {
            toast.error(`${p.name} has no ledger account yet`);
            return;
        }
        setParty({ accountId: p.accountId, name: p.name });
    };

    const handleSave = async () => {
        if (!party) {
            toast.error("Pick or create a service centre first");
            return;
        }
        setSaving(true);
        try {
            await axios.post(`/api/tickets/${ticketId}/shipping-slip`, {
                partyAccountId: party.accountId,
                partyName: party.name,
                ref: form.ref.trim() || null,
                device: { type: form.type, brand: form.brand, model: form.model, problem: form.problem },
                accessories: form.accessories.trim() || null,
                condition: form.condition.trim() || null,
                notes: form.notes.trim() || null,
            });
            toast.success("Shipping slip saved");

            // Print the slip (page auto-fires the print dialog on load).
            window.open(`/shipping-slip/${ticketId}`, "_blank");

            onSaved();
            onClose();
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to save shipping slip");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Truck size={18} /> Create Shipping Slip
                    </DialogTitle>
                    <DialogDescription>
                        Send the device to a service centre. Pick or create the service centre
                        (a Sundry Creditor), check the device details, then save &amp; print.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label>Service Centre <span className="text-muted-foreground font-normal">(Sundry Creditor)</span></Label>
                        {party ? (
                            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                                <span className="font-medium">{party.name}</span>
                                <Button variant="ghost" size="xs" onClick={() => setParty(null)}>Change</Button>
                            </div>
                        ) : (
                            <PartySearchAndCreate
                                partyGroup="Sundry Creditors"
                                defaultToCompany
                                onPicked={onPicked}
                                placeholder="Search service centre by name / phone · ↵ on no-result to create"
                            />
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>Device Type</Label>
                            <Input value={form.type} onChange={(e) => set({ type: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Service Centre Ref / Job # <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input value={form.ref} onChange={(e) => set({ ref: e.target.value })} placeholder="e.g. RMA-2291" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Brand</Label>
                            <Input value={form.brand} onChange={(e) => set({ brand: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Model</Label>
                            <Input value={form.model} onChange={(e) => set({ model: e.target.value })} />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label>Reported Problem</Label>
                        <Textarea value={form.problem} onChange={(e) => set({ problem: e.target.value })} rows={2} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label>Accessories Sent <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input value={form.accessories} onChange={(e) => set({ accessories: e.target.value })} placeholder="e.g. charger, cover" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Physical Condition <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input value={form.condition} onChange={(e) => set({ condition: e.target.value })} placeholder="e.g. minor scratches" />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} placeholder="Anything the service centre should know" />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving || !party}>
                        <Truck size={15} /> {saving ? "Saving…" : "Save & Print"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

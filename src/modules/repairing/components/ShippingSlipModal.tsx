"use client";

import { useEffect, useState } from "react";
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
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

// The shop is code-owned config, not a settings row — no fetch needed.
const SHOP_CONTACT = { name: COMPANY_DETAILS.brandName, phone: COMPANY_DETAILS.contact.phone };

interface DeviceInfo { type: string; brand: string; model: string; problem: string; }

/** The latest slip's stored values — passed in to EDIT it in place. */
export interface ExistingSlip {
    partyAccountId: number;
    partyName: string;
    ref: string | null;
    device: DeviceInfo;
    accessories: string | null;
    condition: string | null;
    notes: string | null;
    showOwner?: boolean;
    contactName?: string | null;
    contactPhone?: string | null;
}

interface Props {
    ticketId: number;
    device: DeviceInfo;
    /** Real device owner — prefills the contact fields when the toggle is on. */
    owner: { name: string; phone: string | null };
    /** When set, the modal edits this slip in place instead of creating a new one. */
    existing?: ExistingSlip | null;
    onClose: () => void;
    onSaved: () => void;
}

// Send-to-service shipping slip. The service centre is a Sundry-Creditor party
// (picked/created via the shared party widget); device details are pre-filled
// from the ticket and editable. On save we persist a snapshot on the ticket and
// open the printable A5 slip. Print-only — it never changes the ticket status;
// the Sending / Waiting / Getting-back stages are configured as normal statuses.
export default function ShippingSlipModal({ ticketId, device, owner, existing, onClose, onSaved }: Props) {
    const isEdit = !!existing;
    const [party, setParty] = useState<{ accountId: number; name: string } | null>(
        existing ? { accountId: existing.partyAccountId, name: existing.partyName } : null,
    );
    const [form, setForm] = useState(() => existing
        ? {
            type: existing.device.type ?? "",
            brand: existing.device.brand ?? "",
            model: existing.device.model ?? "",
            problem: existing.device.problem ?? "",
            ref: existing.ref ?? "",
            accessories: existing.accessories ?? "",
            condition: existing.condition ?? "",
            notes: existing.notes ?? "",
            showOwner: existing.showOwner ?? false,
            contactName: existing.contactName ?? "",
            contactPhone: existing.contactPhone ?? "",
        }
        : {
            type: device.type ?? "",
            brand: device.brand ?? "",
            model: device.model ?? "",
            problem: device.problem ?? "",
            ref: "",
            accessories: "",
            condition: "",
            notes: "",
            // Contact box on the slip — default: shop fronts the contact on behalf
            // of the owner (privacy); toggle prefills the real owner instead. The
            // fields stay editable either way; whatever is typed is what prints.
            showOwner: false,
            contactName: "",
            contactPhone: "",
        });
    const [saving, setSaving] = useState(false);

    const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

    // Seed the default (shop) contact if the user hasn't typed anything yet.
    // On edit we keep exactly what the slip stored (even if blank).
    useEffect(() => {
        setForm((f) => isEdit || f.showOwner || f.contactName || f.contactPhone
            ? f
            : { ...f, contactName: SHOP_CONTACT.name, contactPhone: SHOP_CONTACT.phone });
    }, [isEdit]);

    // Toggle swaps the prefill: owner ↔ shop. Always editable after.
    const toggleShowOwner = (checked: boolean) => {
        setForm((f) => ({
            ...f,
            showOwner: checked,
            contactName: checked ? owner.name : SHOP_CONTACT.name,
            contactPhone: checked ? (owner.phone ?? "") : SHOP_CONTACT.phone,
        }));
    };

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
            const payload = {
                partyAccountId: party.accountId,
                partyName: party.name,
                ref: form.ref.trim() || null,
                device: { type: form.type, brand: form.brand, model: form.model, problem: form.problem },
                accessories: form.accessories.trim() || null,
                condition: form.condition.trim() || null,
                notes: form.notes.trim() || null,
                showOwner: form.showOwner,
                contactName: form.contactName.trim() || null,
                contactPhone: form.contactPhone.trim() || null,
            };
            const url = `/api/tickets/${ticketId}/shipping-slip`;
            if (isEdit) await axios.put(url, payload);
            else await axios.post(url, payload);
            toast.success(isEdit ? "Service slip updated" : "Service slip saved");

            // Open the (updated) slip — the page auto-fires the print dialog on load.
            window.open(`/shipping-slip/${ticketId}`, "_blank");

            onSaved();
            onClose();
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? (isEdit ? "Failed to update service slip" : "Failed to save service slip"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Truck size={18} /> {isEdit ? "Edit Service Slip" : "Create Service Slip"}
                    </DialogTitle>
                    <DialogDescription>
                        {isEdit
                            ? "Correct this slip before the device is sent. Changes overwrite the current slip and are logged on the timeline."
                            : "Send the device to a service centre. Pick or create the service centre (a Sundry Creditor), check the device details, then save & print."}
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

                    <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                            <Label>Device Type</Label>
                            <Input value={form.type} onChange={(e) => set({ type: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Brand</Label>
                            <Input value={form.brand} onChange={(e) => set({ brand: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Model</Label>
                            <Input value={form.model} onChange={(e) => set({ model: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Ref / Job # <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input value={form.ref} onChange={(e) => set({ ref: e.target.value })} placeholder="e.g. RMA-2291" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Accessories <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input value={form.accessories} onChange={(e) => set({ accessories: e.target.value })} placeholder="e.g. charger, cover" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Condition <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input value={form.condition} onChange={(e) => set({ condition: e.target.value })} placeholder="e.g. minor scratches" />
                        </div>
                        <div className="col-span-2 space-y-1.5">
                            <Label>Reported Problem</Label>
                            <Textarea value={form.problem} onChange={(e) => set({ problem: e.target.value })} rows={3} className="resize-y whitespace-pre-wrap break-words" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} placeholder="For the service centre" className="resize-y whitespace-pre-wrap break-words" />
                        </div>
                    </div>

                    {/* Contact box — toggle prefills owner ↔ company details; always editable */}
                    <div className="rounded-md border border-border bg-muted/30 p-3">
                        <div className="flex flex-wrap items-center gap-3">
                            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm select-none">
                                <input
                                    type="checkbox"
                                    checked={form.showOwner}
                                    onChange={(e) => toggleShowOwner(e.target.checked)}
                                    className="h-3.5 w-3.5 accent-primary cursor-pointer"
                                />
                                Show real owner on slip
                            </label>
                            <Input className="h-8 flex-1 min-w-40" value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} placeholder="Contact name" />
                            <Input className="h-8 w-44" value={form.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} placeholder="Contact phone" inputMode="tel" />
                        </div>
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                            {form.showOwner
                                ? "Prefilled with the customer's details — edit freely; what's typed is what prints."
                                : "Prefilled with OUR company details (Settings → Organisation) as \"Contact (on behalf of owner)\" — edit freely."}
                        </p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving || !party}>
                        <Truck size={15} /> {saving ? "Saving…" : isEdit ? "Save Changes & Print" : "Save & Print"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

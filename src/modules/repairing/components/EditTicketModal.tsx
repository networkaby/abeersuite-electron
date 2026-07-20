"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Priority = { id: string; label: string };

export interface EditTicketInitial {
    deviceType: string;
    brand: string;
    model: string;
    problem: string;
    accessories: string;
    priority: string;
    accessInfo: string;
    estimatedCost: string;
    notes: string;
}

interface Props {
    ticketId: number;
    initial: EditTicketInitial;
    onClose: () => void;
    onSaved: () => void;
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
                <span>{label}</span>
                {required && <span className="text-destructive">*</span>}
            </Label>
            {children}
        </div>
    );
}

// Edit an existing repair ticket in place — mirrors the intake form's ticket step,
// minus the party picker (the customer is not changed here). Saves via PUT.
export default function EditTicketModal({ ticketId, initial, onClose, onSaved }: Props) {
    const [form, setForm] = useState<EditTicketInitial>(initial);
    const [priorities, setPriorities] = useState<Priority[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        axios.get<Priority[]>("/api/priorities").then((r) => setPriorities(r.data)).catch(() => { /* keep enum fallback */ });
    }, []);

    const set = <K extends keyof EditTicketInitial>(key: K, value: EditTicketInitial[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    const save = async () => {
        if (!form.deviceType.trim() || !form.brand.trim() || !form.model.trim() || !form.problem.trim()) {
            toast.error("Device type, brand, model and problem are required");
            return;
        }
        setSaving(true);
        try {
            await axios.put(`/api/tickets/${ticketId}`, {
                deviceType: form.deviceType.trim(),
                brand: form.brand.trim(),
                model: form.model.trim(),
                problem: form.problem.trim(),
                accessories: form.accessories,
                priority: form.priority,
                accessInfo: form.accessInfo,
                estimatedCost: form.estimatedCost,
                notes: form.notes,
            });
            toast.success("Ticket updated");
            onSaved();
            onClose();
        } catch (err) {
            toast.error(extractApiError(err, "Failed to update ticket"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-2xl gap-0 p-0 sm:max-w-2xl">
                <DialogHeader className="border-b border-border px-6 py-5 pr-12">
                    <DialogTitle>Edit Ticket #{ticketId}</DialogTitle>
                    <DialogDescription>Update the device, problem and repair details. The customer stays unchanged.</DialogDescription>
                </DialogHeader>

                <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
                    <div className="grid grid-cols-3 gap-3">
                        <Field label="Device Type" required>
                            <Input value={form.deviceType} onChange={(e) => set("deviceType", e.target.value)} placeholder="Laptop, Printer..." autoFocus />
                        </Field>
                        <Field label="Brand" required>
                            <Input value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="HP, Dell..." />
                        </Field>
                        <Field label="Model" required>
                            <Input value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="Model number" />
                        </Field>
                    </div>

                    <Field label="Problem Description" required>
                        <Textarea value={form.problem} onChange={(e) => set("problem", e.target.value)} rows={3} placeholder="Describe the issue..." />
                    </Field>

                    <Field label="Accessories Received">
                        <Textarea value={form.accessories} onChange={(e) => set("accessories", e.target.value)} rows={2} placeholder="Bag, charger, cover, SIM..." />
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Priority">
                            <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
                                <SelectTrigger className="w-full"><SelectValue placeholder="Select priority" /></SelectTrigger>
                                <SelectContent>
                                    {priorities.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label="Estimated Cost">
                            <Input value={form.estimatedCost} onChange={(e) => set("estimatedCost", e.target.value)} type="text" inputMode="decimal" placeholder="0.00" />
                        </Field>
                    </div>

                    <Field label="Access Info">
                        <Input value={form.accessInfo} onChange={(e) => set("accessInfo", e.target.value)} placeholder="Device PIN or password" />
                    </Field>

                    <Field label="Notes">
                        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="Internal notes..." />
                    </Field>
                </div>

                <DialogFooter className="border-t border-border px-6 py-4">
                    <Button onClick={onClose} variant="outline" className="flex-1">Cancel</Button>
                    <Button onClick={save} disabled={saving} className="flex-1">{saving ? "Saving…" : "Save Changes"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

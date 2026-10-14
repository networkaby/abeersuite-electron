"use client";

import { useState, useEffect, type FormEvent } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INDIAN_STATES, stateNameForCode } from "@/shared/lib/gst/indianStates";

type PersonForm = {
    name: string;
    phone: string;
    email: string;
    address: string;
    gstin: string;
    gstStateCode: string;     // derived from gstin, read-only
    shippingStateCode: string; // free-pick, used only when no GSTIN
};

type CreatePersonDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The new party's id, once saved — a list page opens it. */
    onCreated?: (id: number) => void;
    /** Optional phone to seed the form with (e.g. creating a lead from a call). */
    initialPhone?: string;
};

const INITIAL_FORM: PersonForm = {
    name: "",
    phone: "",
    email: "",
    address: "",
    gstin: "",
    gstStateCode: "",
    shippingStateCode: "",
};

export default function CreatePersonDialog({ open, onOpenChange, onCreated, initialPhone }: CreatePersonDialogProps) {
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<PersonForm>(INITIAL_FORM);
    const [serverError, setServerError] = useState<string | null>(null);
    const [showGstSection, setShowGstSection] = useState(false);

    const hasContact = !!(form.phone.trim() || form.email.trim());

    // Clear stale error the moment the user edits a field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (serverError) setServerError(null); }, [form]);
    // Clear when the dialog re-opens; seed the phone if one was passed in.
    useEffect(() => {
        if (open) {
            setServerError(null);
            setShowGstSection(false);
            setForm({ ...INITIAL_FORM, phone: initialPhone ?? "" });
        }
    }, [open, initialPhone]);

    function setField<K extends keyof PersonForm>(field: K, value: PersonForm[K]) {
        setForm((prev) => {
            const next = { ...prev, [field]: value };
            if (field === "gstin" && typeof value === "string") {
                // Mirror first 2 chars of GSTIN onto state code.
                next.gstStateCode = value.length >= 2 ? value.slice(0, 2) : "";
            }
            return next;
        });
    }

    const handleCreatePerson = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setServerError(null);
        if (!form.name.trim()) {
            toast.error("Name is required");
            return;
        }
        if (!hasContact) {
            toast.error("Add at least a phone or email");
            return;
        }

        setSaving(true);
        try {
            const res = await axios.post<{ id: number }>("/api/person", {
                name: form.name,
                phones: form.phone ? [form.phone] : [],
                emails: form.email ? [form.email] : [],
                address: form.address,
                gstin:             form.gstin || undefined,
                gstStateCode:      form.gstStateCode || undefined,
                shippingStateCode: form.shippingStateCode || undefined,
            });
            toast.success("Person created");
            onOpenChange(false);
            onCreated?.(res.data.id);
            setForm(INITIAL_FORM);
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data as { error?: string })?.error
                : undefined;
            const finalMsg = msg ?? "Failed to create person";
            setServerError(finalMsg);
            toast.error(finalMsg);
        } finally {
            setSaving(false);
        }
    };

    const gstStateName = stateNameForCode(form.gstStateCode);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Create Person</DialogTitle>
                    <DialogDescription>Add a new customer person record.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreatePerson} className="space-y-3">
                    {serverError && (
                        <div
                            role="alert"
                            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                        >
                            {serverError}
                        </div>
                    )}
                    <div className="space-y-2">
                        <Label>Name</Label>
                        <Input
                            value={form.name}
                            onChange={(e) => setField("name", e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>
                            Phone <span className="text-[10px] text-muted-foreground">— phone or email required</span>
                        </Label>
                        <Input
                            value={form.phone}
                            onChange={(e) => setField("phone", e.target.value)}
                            aria-invalid={!hasContact}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Email</Label>
                        <Input
                            type="email"
                            value={form.email}
                            onChange={(e) => setField("email", e.target.value)}
                            aria-invalid={!hasContact}
                        />
                    </div>
                    {!hasContact && (
                        <p className="text-[11px] text-destructive">
                            Provide at least a phone number or an email.
                        </p>
                    )}
                    <div className="space-y-2">
                        <Label>Address</Label>
                        <Input
                            value={form.address}
                            onChange={(e) => setField("address", e.target.value)}
                        />
                    </div>

                    {/* GST + shipping section — collapsed by default. Most quick-creates
                        don't need it; the cashier can edit later via PATCH /api/person/[id]. */}
                    <button
                        type="button"
                        onClick={() => setShowGstSection((s) => !s)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                        {showGstSection ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        Tax &amp; shipping (optional)
                    </button>
                    {showGstSection && (
                        <div className="space-y-2 rounded-md border border-dashed bg-muted/30 p-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">GSTIN</Label>
                                <Input
                                    value={form.gstin}
                                    onChange={(e) => setField("gstin", e.target.value.toUpperCase().slice(0, 15))}
                                    placeholder="00ABCDE1234F1Z5"
                                    className="font-mono"
                                />
                                {gstStateName && (
                                    <p className="text-[10px] text-muted-foreground">
                                        GST state: <span className="font-medium">{gstStateName}</span> ({form.gstStateCode})
                                    </p>
                                )}
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Default shipping state</Label>
                                <select
                                    value={form.shippingStateCode}
                                    onChange={(e) => setField("shippingStateCode", e.target.value)}
                                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                                >
                                    <option value="">— none —</option>
                                    {INDIAN_STATES.map((s) => (
                                        <option key={s.code} value={s.code}>
                                            {s.name} ({s.code}){s.isUT ? " · UT" : ""}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-muted-foreground">
                                    Used only on couriered B2C sales (voucher delivery = Shipped). Counter pickups always
                                    treat the customer as same-state per CGST Act §10(1)(c).
                                </p>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={saving || !form.name.trim() || !hasContact}>
                            {saving ? "Creating..." : "Create"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

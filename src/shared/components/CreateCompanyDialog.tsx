"use client";

import { useState, type FormEvent } from "react";
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

type CompanyForm = {
    name: string;
    phone: string;
    email: string;
    address: string;
    companyReg: string;
    taxId: string;
    gstin: string;
    gstStateCode: string;
    shippingStateCode: string;
};

type CreateCompanyDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

const INITIAL_FORM: CompanyForm = {
    name: "",
    phone: "",
    email: "",
    address: "",
    companyReg: "",
    taxId: "",
    gstin: "",
    gstStateCode: "",
    shippingStateCode: "",
};

export default function CreateCompanyDialog({ open, onOpenChange }: CreateCompanyDialogProps) {
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<CompanyForm>(INITIAL_FORM);
    const [showGstSection, setShowGstSection] = useState(false);

    function setField<K extends keyof CompanyForm>(field: K, value: CompanyForm[K]) {
        setForm((prev) => {
            const next = { ...prev, [field]: value };
            if (field === "gstin" && typeof value === "string") {
                next.gstStateCode = value.length >= 2 ? value.slice(0, 2) : "";
            }
            return next;
        });
    }

    const handleCreateCompany = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!form.name.trim()) {
            toast.error("Company name is required");
            return;
        }

        setSaving(true);
        try {
            await axios.post("/api/companies", {
                ...form,
                gstin:             form.gstin || undefined,
                gstStateCode:      form.gstStateCode || undefined,
                shippingStateCode: form.shippingStateCode || undefined,
            });
            toast.success("Company created");
            onOpenChange(false);
            setForm(INITIAL_FORM);
            setShowGstSection(false);
        } catch (err) {
            const msg = axios.isAxiosError(err)
                ? (err.response?.data as { error?: string })?.error
                : undefined;
            toast.error(msg ?? "Failed to create company");
        } finally {
            setSaving(false);
        }
    };

    const gstStateName = stateNameForCode(form.gstStateCode);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Create Company</DialogTitle>
                    <DialogDescription>Add a new company customer record.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateCompany} className="space-y-3">
                    <div className="space-y-2">
                        <Label>Company Name</Label>
                        <Input
                            value={form.name}
                            onChange={(e) => setField("name", e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label>Phone</Label>
                            <Input
                                value={form.phone}
                                onChange={(e) => setField("phone", e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input
                                type="email"
                                value={form.email}
                                onChange={(e) => setField("email", e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label>Company Reg</Label>
                            <Input
                                value={form.companyReg}
                                onChange={(e) => setField("companyReg", e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Tax ID / VAT</Label>
                            <Input
                                value={form.taxId}
                                onChange={(e) => setField("taxId", e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Address</Label>
                        <Input
                            value={form.address}
                            onChange={(e) => setField("address", e.target.value)}
                        />
                    </div>

                    {/* GST + shipping section — collapsed by default. */}
                    <button
                        type="button"
                        onClick={() => setShowGstSection((s) => !s)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                        {showGstSection ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        GST &amp; shipping (optional)
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
                        <Button type="submit" disabled={saving}>
                            {saving ? "Creating..." : "Create"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

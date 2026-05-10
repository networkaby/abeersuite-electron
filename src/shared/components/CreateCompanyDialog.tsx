"use client";

import { useState, type FormEvent } from "react";
import axios from "axios";
import { toast } from "sonner";
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

type CompanyForm = {
    name: string;
    phone: string;
    email: string;
    address: string;
    companyReg: string;
    taxId: string;
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
};

export default function CreateCompanyDialog({ open, onOpenChange }: CreateCompanyDialogProps) {
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<CompanyForm>(INITIAL_FORM);

    const handleCreateCompany = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!form.name.trim()) {
            toast.error("Company name is required");
            return;
        }

        setSaving(true);
        try {
            await axios.post("/api/companies", form);
            toast.success("Company created");
            onOpenChange(false);
            setForm(INITIAL_FORM);
        } catch {
            toast.error("Failed to create company");
        } finally {
            setSaving(false);
        }
    };

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
                            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                            autoFocus
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label>Phone</Label>
                            <Input
                                value={form.phone}
                                onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input
                                type="email"
                                value={form.email}
                                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label>Company Reg</Label>
                            <Input
                                value={form.companyReg}
                                onChange={(e) => setForm((prev) => ({ ...prev, companyReg: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Tax ID / VAT</Label>
                            <Input
                                value={form.taxId}
                                onChange={(e) => setForm((prev) => ({ ...prev, taxId: e.target.value }))}
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Address</Label>
                        <Input
                            value={form.address}
                            onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                        />
                    </div>
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

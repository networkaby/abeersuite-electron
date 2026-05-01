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

type PersonForm = {
    name: string;
    phone: string;
    email: string;
    address: string;
};

type CreatePersonDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

const INITIAL_FORM: PersonForm = {
    name: "",
    phone: "",
    email: "",
    address: "",
};

export default function CreatePersonDialog({ open, onOpenChange }: CreatePersonDialogProps) {
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<PersonForm>(INITIAL_FORM);

    const handleCreatePerson = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!form.name.trim()) {
            toast.error("Name is required");
            return;
        }

        setSaving(true);
        try {
            await axios.post("/api/customers", form);
            toast.success("Person created");
            onOpenChange(false);
            setForm(INITIAL_FORM);
        } catch {
            toast.error("Failed to create person");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Create Person</DialogTitle>
                    <DialogDescription>Add a new customer person record.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreatePerson} className="space-y-3">
                    <div className="space-y-2">
                        <Label>Name</Label>
                        <Input
                            value={form.name}
                            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                            autoFocus
                        />
                    </div>
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

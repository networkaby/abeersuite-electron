"use client";

import { useState, useEffect, type FormEvent } from "react";
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
    const [serverError, setServerError] = useState<string | null>(null);

    const hasContact = !!(form.phone.trim() || form.email.trim());

    // Clear stale error the moment the user edits a field.
    useEffect(() => { if (serverError) setServerError(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [form]);
    // Clear when the dialog re-opens.
    useEffect(() => { if (open) setServerError(null); }, [open]);

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
            await axios.post("/api/people", {
                name: form.name,
                phones: form.phone ? [form.phone] : [],
                emails: form.email ? [form.email] : [],
                address: form.address,
            });
            toast.success("Person created");
            onOpenChange(false);
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
                            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                            autoFocus
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>
                            Phone <span className="text-[10px] text-muted-foreground">— phone or email required</span>
                        </Label>
                        <Input
                            value={form.phone}
                            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                            aria-invalid={!hasContact}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Email</Label>
                        <Input
                            type="email"
                            value={form.email}
                            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
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
                            onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                        />
                    </div>
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

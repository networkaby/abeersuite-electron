"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

const schema = z.object({
    title: z.string().trim().min(1, "Title is required"),
    contactName: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    companyName: z.string().optional(),
    valueRupees: z.string().optional(),
    source: z.string().optional(),
    notes: z.string().optional(),
    status: z.string().min(1),
    ownerUserId: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export type LeadEditInitial = {
    id: number;
    title: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    companyName: string | null;
    valuePaise: number | null;
    source: string | null;
    notes: string | null;
    status: string;
    ownerUserId: number | null;
    ticketStatus: { id: string; label: string; color: string };
};

type StatusOpt = { id: string; label: string };
type UserOpt = { id: number; name: string };

export default function LeadEditForm({
    lead,
    statuses,
    users,
    canManage,
}: {
    lead: LeadEditInitial;
    statuses: StatusOpt[];
    users: UserOpt[];
    canManage: boolean;
}) {
    const router = useRouter();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const valueRupeesInit =
        lead.valuePaise != null && lead.valuePaise > 0 ? String(lead.valuePaise / 100) : "";

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            title: lead.title,
            contactName: lead.contactName ?? "",
            phone: lead.phone ?? "",
            email: lead.email ?? "",
            companyName: lead.companyName ?? "",
            valueRupees: valueRupeesInit,
            source: lead.source ?? "",
            notes: lead.notes ?? "",
            status: lead.status,
            ownerUserId: lead.ownerUserId != null ? String(lead.ownerUserId) : "",
        },
    });

    const onSubmit = form.handleSubmit(async (values) => {
        if (!canManage) return;
        const rupees = values.valueRupees?.trim() ? Number.parseFloat(values.valueRupees) : NaN;
        const valuePaise = Number.isFinite(rupees) && rupees > 0 ? Math.round(rupees * 100) : null;
        try {
            await axios.patch(`/api/crm/leads/${lead.id}`, {
                title: values.title,
                contactName: values.contactName || null,
                phone: values.phone || null,
                email: values.email || null,
                companyName: values.companyName || null,
                valuePaise,
                source: values.source || null,
                notes: values.notes || null,
                status: values.status,
                ownerUserId: values.ownerUserId ? Number(values.ownerUserId) : null,
            });
            toast.success("Lead saved");
            router.refresh();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
            toast.error(msg ?? "Could not save");
        }
    });

    const onDelete = async () => {
        try {
            await axios.delete(`/api/crm/leads/${lead.id}`);
            toast.success("Lead deleted");
            router.push("/office/crm");
            router.refresh();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
            toast.error(msg ?? "Could not delete");
        } finally {
            setDeleteOpen(false);
        }
    };

    if (!canManage) {
        return (
            <div className="space-y-4 border-2 border-border bg-card p-6">
                <p className="text-muted-foreground text-sm">You have view-only access to this lead.</p>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                        <dt className="text-muted-foreground">Stage</dt>
                        <dd className="font-medium">{lead.ticketStatus.label}</dd>
                    </div>
                    <div>
                        <dt className="text-muted-foreground">Title</dt>
                        <dd className="font-medium">{lead.title}</dd>
                    </div>
                </dl>
            </div>
        );
    }

    return (
        <>
            <form onSubmit={onSubmit} className="space-y-6 border-2 border-border bg-card p-6">
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="title">Title</Label>
                        <Input id="title" {...form.register("title")} />
                        {form.formState.errors.title && (
                            <p className="text-destructive text-xs">{form.formState.errors.title.message}</p>
                        )}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="status">Stage</Label>
                        <Select
                            value={form.watch("status")}
                            onValueChange={(v) => form.setValue("status", v)}
                        >
                            <SelectTrigger id="status">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {statuses.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>
                                        {s.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="ownerUserId">Owner</Label>
                        <Select
                            value={form.watch("ownerUserId") || "__none__"}
                            onValueChange={(v) => form.setValue("ownerUserId", v === "__none__" ? "" : v)}
                        >
                            <SelectTrigger id="ownerUserId">
                                <SelectValue placeholder="Unassigned" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">Unassigned</SelectItem>
                                {users.map((u) => (
                                    <SelectItem key={u.id} value={String(u.id)}>
                                        {u.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="contactName">Contact name</Label>
                        <Input id="contactName" {...form.register("contactName")} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="companyName">Company name</Label>
                        <Input id="companyName" {...form.register("companyName")} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="phone">Phone</Label>
                        <Input id="phone" {...form.register("phone")} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" {...form.register("email")} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="valueRupees">Value (₹)</Label>
                        <Input id="valueRupees" type="text" inputMode="decimal" placeholder="0" {...form.register("valueRupees")} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="source">Source</Label>
                        <Input id="source" {...form.register("source")} />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="notes">Notes</Label>
                        <Textarea id="notes" rows={4} {...form.register("notes")} />
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={form.formState.isSubmitting}>
                        {form.formState.isSubmitting ? "Saving…" : "Save changes"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => router.push("/office/crm")}>
                        Back to list
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        className="ml-auto"
                        onClick={() => setDeleteOpen(true)}
                    >
                        Delete
                    </Button>
                </div>
            </form>

            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete lead?</DialogTitle>
                        <DialogDescription>This cannot be undone.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="button" variant="destructive" onClick={onDelete}>
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

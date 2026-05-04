"use client";

import { useRouter } from "next/navigation";
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

const schema = z.object({
    title: z.string().trim().min(1, "Title is required"),
    contactName: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    companyName: z.string().optional(),
    valueRupees: z.string().optional(),
    source: z.string().optional(),
    notes: z.string().optional(),
    status: z.string().optional(),
    ownerUserId: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type StatusOpt = { id: string; label: string };
type UserOpt = { id: number; name: string };

export default function LeadNewForm({
    statuses,
    users,
    defaultStatusId,
}: {
    statuses: StatusOpt[];
    users: UserOpt[];
    defaultStatusId: string;
}) {
    const router = useRouter();
    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            title: "",
            contactName: "",
            phone: "",
            email: "",
            companyName: "",
            valueRupees: undefined,
            source: "",
            notes: "",
            status: defaultStatusId,
            ownerUserId: "",
        },
    });

    const onSubmit = form.handleSubmit(async (values) => {
        const rupees = values.valueRupees?.trim() ? Number.parseFloat(values.valueRupees) : NaN;
        const valuePaise = Number.isFinite(rupees) && rupees > 0 ? Math.round(rupees * 100) : null;
        try {
            const { data } = await axios.post("/api/crm/leads", {
                title: values.title,
                contactName: values.contactName || null,
                phone: values.phone || null,
                email: values.email || null,
                companyName: values.companyName || null,
                valuePaise,
                source: values.source || null,
                notes: values.notes || null,
                status: values.status || undefined,
                ownerUserId: values.ownerUserId ? Number(values.ownerUserId) : null,
            });
            toast.success("Lead created");
            router.push(`/office/crm/leads/${data.id}`);
            router.refresh();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
            toast.error(msg ?? "Could not create lead");
        }
    });

    return (
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
                    <Input id="source" placeholder="walk-in, web…" {...form.register("source")} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea id="notes" rows={4} {...form.register("notes")} />
                </div>
            </div>
            <div className="flex gap-2">
                <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? "Saving…" : "Create lead"}
                </Button>
                <Button type="button" variant="outline" onClick={() => router.push("/office/crm")}>
                    Cancel
                </Button>
            </div>
        </form>
    );
}

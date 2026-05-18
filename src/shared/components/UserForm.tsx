"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import axios from "axios";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogDescription,
    DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem,
    SelectTrigger, SelectValue,
} from "@/components/ui/select";

// Identity-only user creation. Authority — role, branches, departments — is
// granted by appointing the user to a Post (see /office/admin/posts).
// New users land in the "Guest" role (no permissions) until appointment.

type UserOption = { id: number; name: string };

const NONE = "__none__";

const schema = z.object({
    name:      z.string().min(1, "Name is required"),
    email:     z.string().email("Invalid email"),
    title:     z.string().optional(),
    managerId: z.string().optional(),
    password:  z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
    user?: {
        id: number;
        name: string;
        email: string;
        title?: string | null;
        managerId?: number | null;
    };
    onClose: () => void;
}

function FieldError({ message }: { message?: string }) {
    if (!message) return null;
    return <p className="text-xs text-destructive">{message}</p>;
}

export default function UserForm({ user, onClose }: Props) {
    const [users, setUsers] = useState<UserOption[]>([]);

    const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } =
        useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { managerId: NONE } });

    const managerValue = watch("managerId");

    useEffect(() => {
        axios.get<UserOption[]>("/api/users")
            .then((r) => {
                const others = r.data
                    .filter((u: { id: number }) => u.id !== user?.id)
                    .map((u: { id: number; name: string }) => ({ id: u.id, name: u.name }));
                setUsers(others);
            })
            .catch(() => toast.error("Failed to load users"));
    }, [user?.id]);

    useEffect(() => {
        if (user) {
            reset({
                name:      user.name,
                email:     user.email,
                title:     user.title ?? "",
                managerId: user.managerId ? String(user.managerId) : NONE,
                password:  "",
            });
        }
    }, [user, reset]);

    const onSubmit = async (data: FormData) => {
        try {
            const payload = {
                name:      data.name,
                email:     data.email,
                title:     data.title || null,
                managerId: data.managerId && data.managerId !== NONE ? Number(data.managerId) : null,
                ...(data.password ? { password: data.password } : {}),
            };
            if (user) {
                await axios.put(`/api/users/${user.id}`, payload);
                toast.success("User updated");
            } else {
                await axios.post("/api/users", payload);
                toast.success("User created — assign a Post to grant access");
            }
            onClose();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : "Something went wrong";
            toast.error(msg);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{user ? "Edit User" : "Add User"}</DialogTitle>
                    <DialogDescription>
                        {user
                            ? "Update this user's identity. Role, branch, and department are managed via Posts."
                            : "Create a staff account. Once created, appoint them to a Post to grant access."}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

                    {/* ── Identity ── */}
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Full Name</Label>
                            <Input {...register("name")} placeholder="e.g. Ahmed Hassan" />
                            <FieldError message={errors.name?.message} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Email</Label>
                            <Input {...register("email")} placeholder="ahmed@company.com" />
                            <FieldError message={errors.email?.message} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Job Title <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input {...register("title")} placeholder="e.g. Senior Technician" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Reports to <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Select value={managerValue ?? NONE} onValueChange={(v) => setValue("managerId", v)}>
                                <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NONE}>— None —</SelectItem>
                                    {users.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* ── Security ── */}
                    <div className="border-t border-border pt-3 space-y-1.5">
                        <Label>
                            Password{" "}
                            {user && <span className="text-muted-foreground font-normal">(leave blank to keep current)</span>}
                        </Label>
                        <Input
                            {...register("password")}
                            type="password"
                            placeholder={user ? "Leave blank to keep current" : "Min 6 characters"}
                        />
                    </div>

                    {!user && (
                        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-300">
                            <Info size={14} className="shrink-0 mt-0.5" />
                            <p>
                                New users start with no operational access. After saving, open{" "}
                                <span className="font-medium">Posts</span> and appoint them to one or
                                more positions to grant role, branch, and department authority.
                            </p>
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "Saving..." : user ? "Update User" : "Create User"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

type Role = { id: string; label: string; color: string };
type UserOption = { id: number; name: string };

const schema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email"),
    role: z.string().min(1, "Role is required"),
    password: z.string().optional(),
    managerId: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
    user?: {
        id: number;
        name: string;
        email: string;
        role: string;
        managerId?: number | null;
    };
    onClose: () => void;
}

function FieldError({ message }: { message?: string }) {
    if (!message) return null;
    return <p className="text-xs text-destructive">{message}</p>;
}

export default function UserForm({ user, onClose }: Props) {
    const [roles, setRoles] = useState<Role[]>([]);
    const [users, setUsers] = useState<UserOption[]>([]);

    const {
        register,
        handleSubmit,
        reset,
        setValue,
        watch,
        formState: { errors, isSubmitting },
    } = useForm<FormData>({
        resolver: zodResolver(schema),
        defaultValues: { role: "", managerId: "" },
    });

    const roleValue = watch("role");
    const managerValue = watch("managerId");

    useEffect(() => {
        Promise.all([
            axios.get<Role[]>("/api/roles"),
            axios.get<UserOption[]>("/api/users").then((r) =>
                r.data
                    .filter((u) => u.id !== user?.id)
                    .map((u) => ({ id: (u as { id: number }).id, name: (u as { name: string }).name }))
            ),
        ]).then(([rolesRes, usersRes]) => {
            const fetchedRoles = rolesRes.data;
            setRoles(fetchedRoles);
            setUsers(usersRes);

            if (!user && fetchedRoles.length > 0) {
                const defaultRole = fetchedRoles.find(r => r.id === "R2")?.id || fetchedRoles[0].id;
                reset({ name: "", email: "", role: defaultRole, password: "", managerId: "" });
            }
        });
    }, [user?.id, user, reset]);

    useEffect(() => {
        if (user) {
            reset({
                name: user.name,
                email: user.email,
                role: user.role,
                password: "",
                managerId: user.managerId ? String(user.managerId) : "",
            });
        }
    }, [user, reset]);

    const onSubmit = async (data: FormData) => {
        try {
            const payload = {
                name: data.name,
                email: data.email,
                role: data.role,
                managerId: data.managerId ? Number(data.managerId) : null,
                ...(data.password ? { password: data.password } : {}),
            };
            if (user) {
                await axios.put(`/api/users/${user.id}`, payload);
                toast.success("User updated");
            } else {
                await axios.post<{ id: number }>("/api/users", payload);
                toast.success("User created");
            }
            onClose();
        } catch {
            toast.error("Something went wrong");
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{user ? "Edit User" : "Add User"}</DialogTitle>
                    <DialogDescription>
                        Manage staff accounts and their access roles.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="space-y-2">
                        <Label>Name</Label>
                        <Input {...register("name")} placeholder="Full name" />
                        <FieldError message={errors.name?.message} />
                    </div>

                    <div className="space-y-2">
                        <Label>Email</Label>
                        <Input {...register("email")} placeholder="email@example.com" />
                        <FieldError message={errors.email?.message} />
                    </div>

                    <div className="space-y-2">
                        <Label>Role</Label>
                        <Select value={roleValue} onValueChange={(v) => setValue("role", v)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select a role" />
                            </SelectTrigger>
                            <SelectContent>
                                {roles.map((r) => (
                                    <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <FieldError message={errors.role?.message} />
                    </div>

                    <div className="space-y-2">
                        <Label>Reports to <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Select value={managerValue ?? ""} onValueChange={(v) => setValue("managerId", v)}>
                            <SelectTrigger>
                                <SelectValue placeholder="— None —" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="">— None —</SelectItem>
                                {users.map((u) => (
                                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>
                            Password{" "}
                            {user && <span className="text-muted-foreground font-normal">(leave blank to keep current)</span>}
                        </Label>
                        <Input
                            {...register("password")}
                            type="password"
                            placeholder={user ? "Leave blank to keep current" : "Password"}
                        />
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "Saving..." : user ? "Update" : "Add User"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

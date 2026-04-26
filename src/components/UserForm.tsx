"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import axios from "axios";
import { toast } from "sonner";
import { X } from "lucide-react";

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

export default function UserForm({ user, onClose }: Props) {
    const [roles, setRoles] = useState<Role[]>([]);
    const [users, setUsers] = useState<UserOption[]>([]);

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<FormData>({
        resolver: zodResolver(schema),
        defaultValues: { role: "", managerId: "" },
    });

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
                reset({
                    name: "",
                    email: "",
                    role: defaultRole,
                    password: "",
                    managerId: "",
                });
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">{user ? "Edit User" : "Add User"}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Name</label>
                        <input
                            {...register("name")}
                            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="Full name"
                        />
                        {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Email</label>
                        <input
                            {...register("email")}
                            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="email@example.com"
                        />
                        {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Role</label>
                        <select
                            {...register("role")}
                            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                            <option value="">Select a role</option>
                            {roles.map((r) => (
                                <option key={r.id} value={r.id}>{r.label}</option>
                            ))}
                        </select>
                        {errors.role && <p className="text-red-500 text-xs mt-1">{errors.role.message}</p>}
                    </div>

                    {/* Manager picker */}
                    <div>
                        <label className="block text-sm font-medium mb-1">Reports to <span className="text-gray-400">(optional)</span></label>
                        <select
                            {...register("managerId")}
                            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                            <option value="">— None —</option>
                            {users.map((u) => (
                                <option key={u.id} value={String(u.id)}>{u.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">
                            Password {user && <span className="text-gray-400">(leave blank to keep current)</span>}
                        </label>
                        <input
                            {...register("password")}
                            type="password"
                            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder={user ? "Leave blank to keep current" : "Password"}
                        />
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="flex-1 rounded-lg bg-primary py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        >
                            {isSubmitting ? "Saving..." : user ? "Update" : "Add User"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

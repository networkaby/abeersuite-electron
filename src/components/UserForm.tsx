"use client";

import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import axios from "axios";
import { toast } from "sonner";
import { X, Check } from "lucide-react";

type Role = { id: string; label: string; color: string };
type UserOption = { id: number; name: string };

const schema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email"),
    roleIds: z.array(z.string()).min(1, "At least one role is required"),
    primaryRole: z.string().min(1, "Primary role is required"),
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
        userRoles?: { roleId: string; isPrimary: boolean }[];
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
        control,
        setValue,
        formState: { errors, isSubmitting },
    } = useForm<FormData>({
        resolver: zodResolver(schema),
        defaultValues: { roleIds: [], primaryRole: "", managerId: "" },
    });

    const selectedRoleIds = useWatch({ control, name: "roleIds" }) ?? [];
    const primaryRole = useWatch({ control, name: "primaryRole" });

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
                setValue("roleIds", [defaultRole]);
                setValue("primaryRole", defaultRole);
            }
        });
    }, [user?.id, user, setValue]);

    useEffect(() => {
        if (user) {
            const existingRoleIds = user.userRoles?.map((r) => r.roleId) ?? [user.role];
            reset({
                name: user.name,
                email: user.email,
                roleIds: existingRoleIds,
                primaryRole: user.role,
                password: "",
                managerId: user.managerId ? String(user.managerId) : "",
            });
        }
    }, [user, reset]);

    const toggleRole = (roleId: string) => {
        const nextRoleIds = selectedRoleIds.includes(roleId)
            ? selectedRoleIds.length === 1
                ? selectedRoleIds // must keep at least one
                : selectedRoleIds.filter((id) => id !== roleId)
            : [...selectedRoleIds, roleId];

        setValue("roleIds", nextRoleIds, { shouldDirty: true, shouldValidate: true });

        if (!nextRoleIds.includes(primaryRole)) {
            setValue("primaryRole", nextRoleIds[0], { shouldDirty: true, shouldValidate: true });
        }
    };

    const onSubmit = async (data: FormData) => {
        try {
            const payload = {
                name: data.name,
                email: data.email,
                role: data.primaryRole,
                managerId: data.managerId ? Number(data.managerId) : null,
                ...(data.password ? { password: data.password } : {}),
            };

            if (user) {
                await axios.put(`/api/users/${user.id}`, payload);
                // Update multi-role assignment
                await axios.put(`/api/users/${user.id}/roles`, {
                    roleIds: selectedRoleIds,
                    primaryRoleId: data.primaryRole,
                });
                toast.success("User updated");
            } else {
                const created = await axios.post<{ id: number }>("/api/users", payload);
                if (selectedRoleIds.length > 1) {
                    await axios.put(`/api/users/${created.data.id}/roles`, {
                        roleIds: selectedRoleIds,
                        primaryRoleId: data.primaryRole,
                    });
                }
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
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Full name"
                        />
                        {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Email</label>
                        <input
                            {...register("email")}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="email@example.com"
                        />
                        {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
                    </div>

                    {/* Multi-role picker */}
                    <div>
                        <label className="block text-sm font-medium mb-1">Roles</label>
                        <div className="flex flex-wrap gap-2">
                            {roles.map((r) => {
                                const selected = selectedRoleIds.includes(r.id);
                                return (
                                    <button
                                        key={r.id}
                                        type="button"
                                        onClick={() => toggleRole(r.id)}
                                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                                            selected
                                                ? `${r.color} border-current`
                                                : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                                        }`}
                                    >
                                        {selected && <Check size={11} />}
                                        {r.label}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="text-xs text-gray-400 mt-1">Click to toggle. At least one role required.</p>
                    </div>

                    {/* Primary role — only shown if multiple selected */}
                    {selectedRoleIds.length > 1 && (
                        <div>
                            <label className="block text-sm font-medium mb-1">Primary Role</label>
                            <select
                                {...register("primaryRole")}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {selectedRoleIds.map((rid) => {
                                    const r = roles.find((x) => x.id === rid);
                                    return <option key={rid} value={rid}>{r?.label ?? rid}</option>;
                                })}
                            </select>
                            <p className="text-xs text-gray-400 mt-1">Used for dashboard and legacy role checks.</p>
                        </div>
                    )}

                    {/* Manager picker */}
                    <div>
                        <label className="block text-sm font-medium mb-1">Reports to <span className="text-gray-400">(optional)</span></label>
                        <select
                            {...register("managerId")}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                            className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                        >
                            {isSubmitting ? "Saving..." : user ? "Update" : "Add User"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

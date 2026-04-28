"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import axios from "axios";
import { toast } from "sonner";
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

type Role       = { id: string; label: string; color: string; rank: number };
type UserOption = { id: number; name: string };
type Branch     = { id: string; name: string };
type Department = { id: string; name: string };

const NONE = "__none__";

const SCOPE_OPTIONS = [
    { value: "OWN",        label: "Own — only their own records" },
    { value: "TEAM",       label: "Team — direct reports" },
    { value: "DEPARTMENT", label: "Department — all in their dept" },
    { value: "BRANCH",     label: "Branch — all at their branch" },
    { value: "REGION",     label: "Region — multiple branches" },
    { value: "ORG",        label: "Org — everything everywhere" },
];

const schema = z.object({
    name:         z.string().min(1, "Name is required"),
    email:        z.string().email("Invalid email"),
    role:         z.string().min(1, "Role is required"),
    title:        z.string().optional(),
    scope:        z.string().optional(),
    departmentId: z.string().optional(),
    branchId:     z.string().optional(),
    managerId:    z.string().optional(),
    password:     z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
    user?: {
        id: number;
        name: string;
        email: string;
        role: string;
        title?: string | null;
        scope?: string | null;
        departmentId?: string | null;
        branchId?: string | null;
        managerId?: number | null;
    };
    onClose: () => void;
}

function FieldError({ message }: { message?: string }) {
    if (!message) return null;
    return <p className="text-xs text-destructive">{message}</p>;
}

export default function UserForm({ user, onClose }: Props) {
    const [roles, setRoles]           = useState<Role[]>([]);
    const [users, setUsers]           = useState<UserOption[]>([]);
    const [branches, setBranches]     = useState<Branch[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);

    const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } =
        useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { role: "", managerId: NONE, departmentId: NONE, branchId: NONE, scope: "OWN" } });

    const roleValue       = watch("role");
    const managerValue    = watch("managerId");
    const scopeValue      = watch("scope");
    const departmentValue = watch("departmentId");
    const branchValue     = watch("branchId");

    useEffect(() => {
        Promise.all([
            axios.get<Role[]>("/api/roles"),
            axios.get<UserOption[]>("/api/users").then(r =>
                r.data.filter((u: { id: number }) => u.id !== user?.id)
                      .map((u: { id: number; name: string }) => ({ id: u.id, name: u.name }))
            ),
            axios.get<Branch[]>("/api/branches"),
            axios.get<Department[]>("/api/departments"),
        ]).then(([rolesRes, usersRes, branchRes, deptRes]) => {
            setRoles(rolesRes.data);
            setUsers(usersRes);
            setBranches(branchRes.data);
            setDepartments(deptRes.data);

            if (!user && rolesRes.data.length > 0) {
                const defaultRole = rolesRes.data.find(r => r.id === "R2")?.id || rolesRes.data[0].id;
                reset({ name: "", email: "", role: defaultRole, password: "", managerId: NONE, departmentId: NONE, branchId: NONE, scope: "OWN" });
            }
        });
    }, [user?.id, user, reset]);

    useEffect(() => {
        if (user) {
            reset({
                name:         user.name,
                email:        user.email,
                role:         user.role,
                title:        user.title ?? "",
                scope:        user.scope ?? "OWN",
                departmentId: user.departmentId ?? NONE,
                branchId:     user.branchId ?? NONE,
                managerId:    user.managerId ? String(user.managerId) : NONE,
                password:     "",
            });
        }
    }, [user, reset]);

    const onSubmit = async (data: FormData) => {
        try {
            const payload = {
                name:         data.name,
                email:        data.email,
                role:         data.role,
                title:        data.title || null,
                scope:        data.scope || "OWN",
                departmentId: data.departmentId && data.departmentId !== NONE ? data.departmentId : null,
                branchId:     data.branchId && data.branchId !== NONE ? data.branchId : null,
                managerId:    data.managerId && data.managerId !== NONE ? Number(data.managerId) : null,
                ...(data.password ? { password: data.password } : {}),
            };
            if (user) {
                await axios.put(`/api/users/${user.id}`, payload);
                toast.success("User updated");
            } else {
                await axios.post("/api/users", payload);
                toast.success("User created");
            }
            onClose();
        } catch (e: unknown) {
            const msg = axios.isAxiosError(e) ? e.response?.data?.error : "Something went wrong";
            toast.error(msg);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{user ? "Edit User" : "Add User"}</DialogTitle>
                    <DialogDescription>Manage staff accounts and their access profile.</DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

                    {/* ── Identity ── */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5 col-span-2">
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
                    </div>

                    {/* ── Org placement ── */}
                    <div className="border-t border-border pt-3 space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Org Placement</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Department <span className="text-muted-foreground font-normal">(optional)</span></Label>
                                <Select value={departmentValue ?? NONE} onValueChange={v => setValue("departmentId", v)}>
                                    <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={NONE}>— None —</SelectItem>
                                        {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Branch <span className="text-muted-foreground font-normal">(optional)</span></Label>
                                <Select value={branchValue ?? NONE} onValueChange={v => setValue("branchId", v)}>
                                    <SelectTrigger><SelectValue placeholder="— All branches —" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={NONE}>— All branches —</SelectItem>
                                        {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    {/* ── Access ── */}
                    <div className="border-t border-border pt-3 space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Access Control</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Role</Label>
                                <Select value={roleValue} onValueChange={v => setValue("role", v)}>
                                    <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
                                    <SelectContent>
                                        {roles.map(r => (
                                            <SelectItem key={r.id} value={r.id}>
                                                {r.label} <span className="text-muted-foreground text-xs ml-1">rank {r.rank}</span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FieldError message={errors.role?.message} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Data Scope</Label>
                                <Select value={scopeValue ?? "OWN"} onValueChange={v => setValue("scope", v)}>
                                    <SelectTrigger><SelectValue placeholder="OWN" /></SelectTrigger>
                                    <SelectContent>
                                        {SCOPE_OPTIONS.map(s => (
                                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Reports to <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Select value={managerValue ?? NONE} onValueChange={v => setValue("managerId", v)}>
                                <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NONE}>— None —</SelectItem>
                                    {users.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
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
                        <Input {...register("password")} type="password" placeholder={user ? "Leave blank to keep current" : "Min 6 characters"} />
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "Saving..." : user ? "Update User" : "Add User"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

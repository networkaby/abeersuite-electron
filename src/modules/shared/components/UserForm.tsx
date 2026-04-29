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
    name:      z.string().min(1, "Name is required"),
    email:     z.string().email("Invalid email"),
    role:      z.string().min(1, "Role is required"),
    title:     z.string().optional(),
    scope:     z.string().optional(),
    managerId: z.string().optional(),
    password:  z.string().optional(),
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
        managerId?: number | null;
        departments: { id: string; name: string }[];
        branches:    { id: string; name: string }[];
    };
    onClose: () => void;
}

function FieldError({ message }: { message?: string }) {
    if (!message) return null;
    return <p className="text-xs text-destructive">{message}</p>;
}

function MultiCheckList({
    label,
    items,
    selected,
    onChange,
}: {
    label: string;
    items: { id: string; name: string }[];
    selected: string[];
    onChange: (ids: string[]) => void;
}) {
    const toggle = (id: string) =>
        onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

    return (
        <div className="space-y-1.5">
            <Label>{label} <span className="text-muted-foreground font-normal">(optional — pick multiple)</span></Label>
            {items.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No {label.toLowerCase()} added yet</p>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {items.map(item => {
                        const checked = selected.includes(item.id);
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => toggle(item.id)}
                                className={[
                                    "flex items-center gap-1.5 border-2 px-2.5 py-1 text-xs font-medium transition-colors",
                                    checked
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
                                ].join(" ")}
                            >
                                <span className={[
                                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center border transition-colors",
                                    checked ? "border-primary bg-primary" : "border-muted-foreground",
                                ].join(" ")}>
                                    {checked && (
                                        <svg viewBox="0 0 10 10" className="h-2 w-2 text-white fill-current">
                                            <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    )}
                                </span>
                                {item.name}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default function UserForm({ user, onClose }: Props) {
    const [roles, setRoles]           = useState<Role[]>([]);
    const [users, setUsers]           = useState<UserOption[]>([]);
    const [branches, setBranches]     = useState<Branch[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [selectedDepts, setSelectedDepts] = useState<string[]>(user?.departments.map(d => d.id) ?? []);
    const [selectedBranches, setSelectedBranches] = useState<string[]>(user?.branches.map(b => b.id) ?? []);

    const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } =
        useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { role: "", managerId: NONE, scope: "OWN" } });

    // eslint-disable-next-line react-hooks/incompatible-library
    const roleValue    = watch("role");
    const managerValue = watch("managerId");
    const scopeValue   = watch("scope");

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
                reset({ name: "", email: "", role: defaultRole, password: "", managerId: NONE, scope: "OWN" });
            }
        }).catch(() => toast.error("Failed to load form data"));
    }, [user?.id, user, reset]);

    useEffect(() => {
        if (user) {
            reset({
                name:      user.name,
                email:     user.email,
                role:      user.role,
                title:     user.title ?? "",
                scope:     user.scope ?? "OWN",
                managerId: user.managerId ? String(user.managerId) : NONE,
                password:  "",
            });
            setSelectedDepts(user.departments.map(d => d.id));
            setSelectedBranches(user.branches.map(b => b.id));
        }
    }, [user, reset]);

    const onSubmit = async (data: FormData) => {
        try {
            const payload = {
                name:          data.name,
                email:         data.email,
                role:          data.role,
                title:         data.title || null,
                scope:         data.scope || "OWN",
                departmentIds: selectedDepts,
                branchIds:     selectedBranches,
                managerId:     data.managerId && data.managerId !== NONE ? Number(data.managerId) : null,
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
                        <MultiCheckList
                            label="Departments"
                            items={departments}
                            selected={selectedDepts}
                            onChange={setSelectedDepts}
                        />
                        <MultiCheckList
                            label="Branches"
                            items={branches}
                            selected={selectedBranches}
                            onChange={setSelectedBranches}
                        />
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

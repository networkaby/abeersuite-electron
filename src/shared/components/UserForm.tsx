"use client";

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
import { useEffect } from "react";

// Identity-only user creation.
//
// Job title, reporting hierarchy, role, branch, and department all flow from
// Position appointments — see /office/admin/positions. Permission punishments
// / rewards are layered on top via the per-user PermissionsModal (shield icon
// in the users table).

const schema = z.object({
    name:     z.string().min(1, "Name is required"),
    email:    z.string().email("Invalid email"),
    password: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
    user?: {
        id: number;
        name: string;
        email: string;
    };
    onClose: () => void;
}

function FieldError({ message }: { message?: string }) {
    if (!message) return null;
    return <p className="text-xs text-destructive">{message}</p>;
}

export default function UserForm({ user, onClose }: Props) {
    const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
        useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { name: "", email: "", password: "" } });

    useEffect(() => {
        if (user) {
            reset({ name: user.name, email: user.email, password: "" });
        }
    }, [user, reset]);

    const onSubmit = async (data: FormData) => {
        try {
            const payload = {
                name:  data.name,
                email: data.email,
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
                            ? "Update this user's identity. Role, branch, department, and reporting line all come from Post appointments."
                            : "Create a staff account. Once created, appoint them to a Post to grant access."}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
                    </div>

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
                                <span className="font-medium">Posts</span> and appoint them to a
                                position — that assigns their job title, branch, department, and
                                reporting line all at once.
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

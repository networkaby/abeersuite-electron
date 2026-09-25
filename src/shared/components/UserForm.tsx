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
import { FieldError } from "@/shared/components/FieldError";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

const STAFF_DOMAIN = COMPANY_DETAILS.staffMailDomain;

// Identity-only user creation.
//
// Job title, reporting hierarchy, role, branch, and department all flow from
// Position appointments — see /office/admin/positions. Permission punishments
// / rewards are layered on top via the per-user PermissionsModal (shield icon
// in the users table).

// A new account's address is always `name@<staff domain>`, so the form asks only for
// the name part — nothing to mistype. Editing keeps the full box: older accounts may
// sit on another domain. No Cloudflare step here: the zone's catch-all takes the new
// address's mail until the person (or an admin) sets a forward on the profile.
const schema = z.object({
    name:     z.string().min(1, "Name is required"),
    email:    z.string().trim().min(1, "Email is required"),
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
    /** Told the saved row (create or update) before `onClose` — the Staff
     *  Directory uses it to open the new person's HR profile straight away. */
    onSaved?: (user: { id: number; name: string; email: string }) => void;
}

export default function UserForm({ user, onClose, onSaved }: Props) {
    const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
        useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { name: "", email: "", password: "" } });

    useEffect(() => {
        if (user) {
            reset({ name: user.name, email: user.email, password: "" });
        }
    }, [user, reset]);

    const onSubmit = async (data: FormData) => {
        const email = user ? data.email : `${data.email.toLowerCase()}@${STAFF_DOMAIN}`;
        if (!z.string().email().safeParse(email).success) {
            toast.error(user ? "Invalid email" : "Use letters, digits, dots or dashes before the @");
            return;
        }
        try {
            const payload = {
                name:  data.name,
                email,
                ...(data.password ? { password: data.password } : {}),
            };
            if (user) {
                const { data: saved } = await axios.put<{ id: number; name: string; email: string }>(`/api/users/${user.id}`, payload);
                toast.success("User updated");
                onSaved?.(saved);
            } else {
                const { data: saved } = await axios.post<{ id: number; name: string; email: string }>("/api/users", payload);
                toast.success("User created — assign a Post to grant access");
                onSaved?.(saved);
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
                            {user ? (
                                <Input {...register("email")} placeholder={`ahmed@${STAFF_DOMAIN}`} />
                            ) : (
                                <>
                                    <div className="flex items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
                                        <Input
                                            {...register("email", { setValueAs: (v: string) => v.replace(/@.*$/, "").trim() })}
                                            placeholder="ahmed"
                                            autoComplete="off"
                                            className="border-0 shadow-none focus-visible:ring-0"
                                        />
                                        <span className="pr-3 text-sm text-muted-foreground">@{STAFF_DOMAIN}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Mail goes to the catch-all inbox until a forward is set on their profile.
                                    </p>
                                </>
                            )}
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

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
const DEFAULT_FORWARD = COMPANY_DETAILS.staffMailDefaultForward;

// Identity-only add / edit of a staff login — name, email, password. The one
// dialog behind Admin → Users and HR → Staff Directory's Add staff. Editing keeps
// the sign-in email read-only: it is renamed on HR → Access (admin) or the person's
// own Security tab, both of which move the Cloudflare forward with it.
//
// Job title, reporting line, role, branch and department all flow from the seat
// (Position) they are appointed to — the Appoint button on their HR profile.
// One-off extra permissions sit on Admin → Users' shield button.

// A new company address is `name@<staff domain>`, so the form asks only for the name
// part — nothing to mistype — and forwards it to the office default. Changing where
// it goes afterwards is the Staff Directory Login card's Forward to row.
const schema = z.object({
    name:     z.string().min(1, "Name is required"),
    email:    z.string().trim(),
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
        if (user) reset({ name: user.name, email: "", password: "" });
    }, [user, reset]);

    const onSubmit = async (data: FormData) => {
        const email = `${data.email.toLowerCase()}@${STAFF_DOMAIN}`;
        if (!user && !z.string().email().safeParse(email).success) {
            toast.error("Use letters, digits, dots or dashes before the @");
            return;
        }
        try {
            // Editing sends only name and a new password — never the email, never a
            // stale copy of it over a rename made elsewhere.
            const payload = user
                ? { name: data.name, ...(data.password ? { password: data.password } : {}) }
                : { name: data.name, email, password: data.password, forwardTo: DEFAULT_FORWARD };
            type Saved = { id: number; name: string; email: string; forwardingError?: string | null };
            const { data: saved } = user
                ? await axios.put<Saved>(`/api/users/${user.id}`, payload)
                : await axios.post<Saved>("/api/users", payload);
            toast.success(user ? "User updated" : `${saved.name} added — appoint them to a seat to give access`);
            if (saved.forwardingError) toast.warning(`Saved, but the mail forward was not: ${saved.forwardingError}`);
            onSaved?.(saved);
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
                            ? "Name and password. Role, branch, department and reporting line come from their seat."
                            : "Create a staff login. Once created, appoint them to a seat to give access."}
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
                                <>
                                    <p className="text-sm">{user.email}</p>
                                    <p className="text-xs text-muted-foreground">Renamed on HR &amp; People → Staff Directory → Access.</p>
                                </>
                            ) : (
                                <div className="flex items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
                                    <Input
                                        {...register("email", { setValueAs: (v: string) => v.replace(/@.*$/, "").trim() })}
                                        placeholder="ahmed"
                                        autoComplete="off"
                                        className="border-0 shadow-none focus-visible:ring-0"
                                    />
                                    <span className="pr-3 text-sm text-muted-foreground">@{STAFF_DOMAIN}</span>
                                </div>
                            )}
                            <FieldError message={errors.email?.message} />
                        </div>
                    </div>

                    <div className="border-t border-border pt-3 space-y-1.5">
                        <Label>
                            Password{" "}
                            {user && <span className="text-muted-foreground font-normal">(leave blank to keep current)</span>}
                        </Label>
                        {/* new-password: stops the browser dropping YOUR saved password in
                            here — pressing Update would then quietly set it as theirs. */}
                        <Input
                            {...register("password")}
                            type="password"
                            autoComplete="new-password"
                            placeholder={user ? "Leave blank to keep current" : "Min 6 characters"}
                        />
                    </div>

                    {!user && (
                        <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-300">
                            <Info size={14} className="shrink-0 mt-0.5" />
                            <p>
                                New staff start with no access. After saving, use{" "}
                                <span className="font-medium">Appoint</span> on their HR profile
                                (HR &amp; People → Staff Directory) — it gives their seat, branch,
                                department and joining date all at once.
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

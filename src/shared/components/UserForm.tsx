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
import { useEffect, useState } from "react";
import { FieldError } from "@/shared/components/FieldError";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

const STAFF_DOMAIN = COMPANY_DETAILS.staffMailDomain;
const DEFAULT_FORWARD = COMPANY_DETAILS.staffMailDefaultForward;
const isCompanyAddress = (email: string) => email.toLowerCase().endsWith(`@${STAFF_DOMAIN}`);

/** What `/api/users/[id]/forward-email` reports — where their company mail goes now. */
type Forwarding = { forwardTo: string | null; verified: boolean; catchAll: string | null };

// Identity-only add / edit of a staff login — name, email, password. The one
// dialog behind both Admin → Users and HR → Staff Directory (Add staff, and the
// Access tab's Edit login), so the two pages can never save a person differently.
//
// Job title, reporting line, role, branch and department all flow from the seat
// (Position) they are appointed to — the Appoint button on their HR profile.
// One-off extra permissions sit on Admin → Users' shield button.

// A company address is `name@<staff domain>`, so the form asks only for the name part
// — nothing to mistype. An older login on another domain keeps its full box until the
// admin presses "Give company email". "Forward to" is where that address's mail goes
// (Cloudflare Email Routing): saved after the login, created if Cloudflare has no rule
// for it and edited if it has; a renamed address carries its forward along.
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
    const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } =
        useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { name: "", email: "", password: "" } });

    const [company, setCompany] = useState(!user || isCompanyAddress(user.email));
    const [forwardTo, setForwardTo] = useState(user ? "" : DEFAULT_FORWARD);
    /** Where it forwards now; null while loading or when there is nothing to read. */
    const [current, setCurrent] = useState<Forwarding | null>(null);
    const [forwardNote, setForwardNote] = useState("");

    useEffect(() => {
        if (user) {
            reset({ name: user.name, email: isCompanyAddress(user.email) ? user.email.split("@")[0] : user.email, password: "" });
        }
    }, [user, reset]);

    // An existing company address: show where its mail goes now, prefill the box.
    useEffect(() => {
        if (!user || !isCompanyAddress(user.email)) return;
        let live = true;
        axios.get<Forwarding>(`/api/users/${user.id}/forward-email`)
            .then(({ data }) => {
                if (!live) return;
                setCurrent(data);
                setForwardTo(f => f || data.forwardTo || DEFAULT_FORWARD);
            })
            .catch(e => { if (live) setForwardNote(axios.isAxiosError(e) ? e.response?.data?.error ?? "" : ""); });
        return () => { live = false; };
    }, [user]);

    /** An older login on another domain: switch to a company address, and keep its
     *  mail flowing to the inbox it used before. */
    const giveCompanyEmail = () => {
        if (!user) return;
        setCompany(true);
        setValue("email", user.email.split("@")[0].toLowerCase());
        setForwardTo(user.email.toLowerCase());
    };

    const onSubmit = async (data: FormData) => {
        const email = company ? `${data.email.toLowerCase()}@${STAFF_DOMAIN}` : data.email;
        if (!z.string().email().safeParse(email).success) {
            toast.error(company ? "Use letters, digits, dots or dashes before the @" : "Invalid email");
            return;
        }
        const target = forwardTo.trim().toLowerCase();
        if (company && target && !z.string().email().safeParse(target).success) {
            toast.error("Forward to must be an email address");
            return;
        }
        try {
            const payload = {
                name:  data.name,
                email,
                ...(data.password ? { password: data.password } : {}),
                // Only when it changes something — an unchanged box costs no Cloudflare call.
                ...(company && target && target !== current?.forwardTo ? { forwardTo: target } : {}),
            };
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
                            ? "Name, sign-in email and password. Role, branch, department and reporting line come from their seat."
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
                            {company ? (
                                <div className="flex items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
                                    <Input
                                        {...register("email", { setValueAs: (v: string) => v.replace(/@.*$/, "").trim() })}
                                        placeholder="ahmed"
                                        autoComplete="off"
                                        className="border-0 shadow-none focus-visible:ring-0"
                                    />
                                    <span className="pr-3 text-sm text-muted-foreground">@{STAFF_DOMAIN}</span>
                                </div>
                            ) : (
                                <>
                                    <Input {...register("email")} autoComplete="off" />
                                    <button type="button" className="text-xs text-primary underline" onClick={giveCompanyEmail}>
                                        Give company email (@{STAFF_DOMAIN})
                                    </button>
                                </>
                            )}
                            <FieldError message={errors.email?.message} />
                        </div>
                        {company && (
                            <div className="space-y-1.5">
                                <Label>Forward to</Label>
                                <Input
                                    type="email"
                                    autoComplete="off"
                                    value={forwardTo}
                                    onChange={e => setForwardTo(e.target.value)}
                                    placeholder={DEFAULT_FORWARD}
                                />
                                <p className="text-xs text-muted-foreground">
                                    {forwardNote
                                        || (current?.forwardTo
                                            ? `Now: ${current.forwardTo}${current.verified ? "" : " (waiting for verify)"}`
                                            : current?.catchAll
                                                ? `Now: catch-all (${current.catchAll}). Save to forward it here.`
                                                : "Where their company mail goes. A new inbox gets Cloudflare's verify email first.")}
                                </p>
                            </div>
                        )}
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

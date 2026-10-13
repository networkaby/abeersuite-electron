"use client";

// Password and forwarding for the person or an admin (`users:edit`); the counter
// PIN only ever for the person themselves — its route has no id to aim elsewhere.

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForwardEmail } from "@/shared/hooks/useForwardEmail";
import { PIN_LENGTH } from "@/shared/lib/constants/session";

const securitySchema = z.object({
    currentPassword: z.string(),
    password: z.string().min(6, "Min 6 characters"),
    confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });
type SecurityForm = z.infer<typeof securitySchema>;

export default function SecurityTab({ profileId, isSelf }: { profileId: number; isSelf: boolean }) {
    const [saving, setSaving] = useState(false);
    const { register, handleSubmit, reset, formState: { errors } } = useForm<SecurityForm>({
        resolver: zodResolver(securitySchema),
        defaultValues: { currentPassword: "", password: "", confirmPassword: "" },
    });

    const onSubmit = async (data: SecurityForm) => {
        if (isSelf && !data.currentPassword) { toast.error("Enter your current password"); return; }
        setSaving(true);
        try {
            await axios.patch(`/api/users/${profileId}/password`, {
                password: data.password,
                ...(isSelf && { currentPassword: data.currentPassword }),
            });
            toast.success("Password changed successfully");
            reset();
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error : "Failed to change password");
        } finally { setSaving(false); }
    };

    return (
        <div className="flex flex-wrap items-start gap-4 [&>*]:w-full [&>*]:sm:w-80">
            {isSelf && <CounterPinCard />}
            <form onSubmit={handleSubmit(onSubmit)} className="rounded-lg border border-border bg-card p-5 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                    <Lock size={14} className="text-muted-foreground" />
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Change Password</h3>
                </div>
                <p className="text-xs text-muted-foreground">Choose a strong password of at least 6 characters.</p>
                {isSelf && (
                    <div className="space-y-1.5">
                        <Label>Current Password</Label>
                        <Input {...register("currentPassword")} type="password" autoComplete="current-password" placeholder="Your password now" />
                    </div>
                )}
                <div className="space-y-1.5">
                    <Label>New Password</Label>
                    <Input {...register("password")} type="password" placeholder="Min 6 characters" />
                    {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
                </div>
                <div className="space-y-1.5">
                    <Label>Confirm Password</Label>
                    <Input {...register("confirmPassword")} type="password" placeholder="Repeat new password" />
                    {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
                </div>
                <div className="flex justify-end pt-1">
                    <Button type="submit" disabled={saving}>{saving ? "Changing…" : "Change Password"}</Button>
                </div>
            </form>
            <ForwardEmailCard userId={profileId} isSelf={isSelf} />
        </div>
    );
}

/** Where a staff address forwards — Cloudflare Email Routing. Until it is set, the
 *  catch-all takes the mail, so "Forgot password" codes reach the office, not the person. */
function ForwardEmailCard({ userId, isSelf }: { userId: number; isSelf: boolean }) {
    const { state, unavailable, forwardTo, setForwardTo, handle, setHandle, busy, load, save, status } = useForwardEmail(userId);
    const domain = state?.address.split("@")[1];

    return (
        <form onSubmit={e => { e.preventDefault(); void save(true); }} className="rounded-lg border border-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
                <Mail size={14} className="text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Forward Email</h3>
            </div>
            {unavailable ? (
                <p className="text-xs text-muted-foreground">{unavailable}</p>
            ) : (
                <>
                    <p className="text-xs text-muted-foreground">
                        Company mail goes to the personal inbox — needed for Forgot password.
                        The company email is also {isSelf ? "your" : "their"} sign-in ID.
                    </p>
                    <div className="space-y-1.5">
                        <Label>Company email</Label>
                        <div className="flex items-center gap-1.5">
                            <Input value={handle} onChange={e => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))} placeholder="name" disabled={!state} />
                            <span className="shrink-0 text-sm text-muted-foreground">@{domain ?? "…"}</span>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Forward to</Label>
                        <Input type="email" autoComplete="email" value={forwardTo} onChange={e => setForwardTo(e.target.value)} placeholder="you@gmail.com" />
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                        <button type="button" className="text-xs text-muted-foreground underline" onClick={() => void load()}>
                            {state ? status : "Loading…"}
                        </button>
                        <Button type="submit" disabled={busy || !state || !forwardTo.trim() || !handle}>{busy ? "Saving…" : "Save"}</Button>
                    </div>
                </>
            )}
        </form>
    );
}

/** Your own counter PIN — `/api/me/counter-pin` has no user id, so this only ever
 *  touches the signed-in person. Setting works only on a counter (the route says so
 *  when it is not); removing from all counters works anywhere. Both need the line up. */
function CounterPinCard() {
    const [pin, setPin] = useState("");
    const [pinAgain, setPinAgain] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const digits = (v: string) => v.replace(/\D/g, "").slice(0, PIN_LENGTH);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (pin !== pinAgain) { toast.error("The two PINs are not the same."); return; }
        setBusy(true);
        try {
            await axios.put("/api/me/counter-pin", { pin, password });
            toast.success("PIN saved for this counter");
            setPin(""); setPinAgain(""); setPassword("");
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error ?? "Could not reach the office" : "Could not save your PIN");
        } finally { setBusy(false); }
    };

    const remove = async (scope: "counter" | "all") => {
        const where = scope === "all" ? "every counter" : "this counter";
        if (!confirm(`Remove your PIN from ${where}? You will unlock with your password there.`)) return;
        setBusy(true);
        try {
            await axios.delete(`/api/me/counter-pin?scope=${scope}`);
            toast.success(`PIN removed from ${where}`);
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error ?? "Could not reach the office" : "Could not remove your PIN");
        } finally { setBusy(false); }
    };

    return (
        <form onSubmit={save} className="rounded-lg border border-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
                <Lock size={14} className="text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Counter PIN</h3>
            </div>
            <p className="text-xs text-muted-foreground">Four digits to unlock this counter when it is locked. Saved only for the counter you are on.</p>
            <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                    <Label>New PIN</Label>
                    <Input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(digits(e.target.value))} placeholder="4 digits" />
                </div>
                <div className="space-y-1.5">
                    <Label>Confirm PIN</Label>
                    <Input type="password" inputMode="numeric" autoComplete="off" value={pinAgain} onChange={e => setPinAgain(digits(e.target.value))} placeholder="Repeat" />
                </div>
            </div>
            <div className="space-y-1.5">
                <Label>Your Password</Label>
                <Input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Needed to set a PIN" />
            </div>
            <div className="flex justify-end pt-1">
                <Button type="submit" disabled={busy || pin.length !== PIN_LENGTH || !password}>{busy ? "Saving…" : "Set PIN"}</Button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
                <span className="mr-auto text-xs text-muted-foreground">Remove PIN</span>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => remove("counter")}>This counter</Button>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => remove("all")}>All counters</Button>
            </div>
        </form>
    );
}

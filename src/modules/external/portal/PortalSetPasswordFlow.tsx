"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PortalOtpLoginForm from "@/modules/external/portal/PortalOtpLoginForm";
import type { OtpChannel } from "@/shared/lib/auth/portalPasswordless";

/**
 * Verify a mobile/email, then set the portal password for it.
 *
 * Creating an account and resetting a forgotten password are the same two steps
 * — prove the number is yours, then choose a password — so they share this one
 * component and one API route. Only the wording and the name field differ.
 *
 * The OTP ticket is still valid after the password is saved, so we sign the
 * customer straight in with it rather than dropping them back on the login page
 * to type the password they just chose.
 */
export default function PortalSetPasswordFlow({ mode }: { mode: "register" | "reset" }) {
    const router = useRouter();
    const registering = mode === "register";

    const [verified, setVerified] = useState<{ token: string; identity: string } | null>(null);
    const [name, setName] = useState("");
    const [extraContact, setExtraContact] = useState("");
    const [channel, setChannel] = useState<OtpChannel>("mobile");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const onVerified = (token: string, ch: OtpChannel, identity: string) => {
        setChannel(ch);
        setVerified({ token, identity });
        setError("");
    };

    if (!verified) {
        return (
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    {registering
                        ? "First, confirm your mobile or email so we can link you to your existing orders."
                        : "Confirm your mobile or email and we will let you pick a new password."}
                </p>
                <PortalOtpLoginForm onVerified={onVerified} busy={busy} submitError="" />
            </div>
        );
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirm) {
            setError("The two passwords do not match.");
            return;
        }
        setBusy(true);
        setError("");
        try {
            const res = await fetch("/api/portal/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    token: verified.token,
                    password,
                    name: name.trim(),
                    extraContact: extraContact.trim(),
                }),
            });
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            if (!res.ok) {
                setError(body?.error ?? "Could not save your password. Please try again.");
                return;
            }
            // The ticket is still good, so finish on the portal rather than
            // sending them back to type the password they just set.
            const signedIn = await signIn("credentials-portal-passwordless", {
                token: verified.token,
                name: name.trim(),
                extraContact: extraContact.trim(),
                redirect: false,
            });
            if (signedIn?.error) {
                router.push("/login");
                return;
            }
            router.push("/portal");
            router.refresh();
        } catch {
            setError("Could not save your password. Please try again.");
        } finally {
            setBusy(false);
        }
    };

    // They verified one channel — offer the other one, optionally.
    const extraLabel = channel === "mobile" ? "Email" : "Mobile";

    return (
        <form onSubmit={submit} className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm">
                <BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                    <span className="font-medium">{verified.identity}</span> is verified.
                    {registering ? " Choose a password and you are in." : " Pick a new password."}
                </span>
            </div>

            {registering && (
                <>
                    <div className="space-y-2">
                        <Label htmlFor="set-name">Your name</Label>
                        <Input
                            id="set-name"
                            autoComplete="name"
                            placeholder="e.g. Rahul Sharma"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="set-extra" className="flex items-center gap-2">
                            {extraLabel}
                            <span className="text-xs font-normal text-muted-foreground">optional</span>
                        </Label>
                        <Input
                            id="set-extra"
                            type={channel === "mobile" ? "email" : "tel"}
                            inputMode={channel === "mobile" ? "email" : "numeric"}
                            autoComplete={channel === "mobile" ? "email" : "tel"}
                            placeholder={channel === "mobile" ? "you@example.com" : "98765 43210"}
                            value={extraContact}
                            onChange={(e) => setExtraContact(e.target.value)}
                        />
                    </div>
                </>
            )}

            <div className="space-y-2">
                <Label htmlFor="set-password">{registering ? "Password" : "New password"}</Label>
                <Input
                    id="set-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                    required
                    autoFocus={!registering}
                />
            </div>
            <div className="space-y-2">
                <Label htmlFor="set-confirm">Repeat password</Label>
                <Input
                    id="set-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    minLength={6}
                    required
                />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={busy || password.length < 6}>
                {busy
                    ? "Saving…"
                    : registering
                      ? "Create account & continue"
                      : "Save password & continue"}
            </Button>
        </form>
    );
}

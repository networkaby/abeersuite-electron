"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isPhoneAppPath, PHONE_APP_SIGN_IN } from "@/shared/lib/device/phone";

/**
 * Staff password reset. The code goes to the staff address; Cloudflare forwards it to
 * the person's own inbox — set on My Profile → Security → Forward Email.
 */
export default function StaffForgotPasswordPage() {
    const router = useRouter();
    // Also served inside the phone app (m-staff-app/forgot-password): go back to its sign-in.
    const signInPath = isPhoneAppPath(usePathname()) ? PHONE_APP_SIGN_IN : "/staff/login";
    const [email, setEmail] = useState("");
    const [sent, setSent] = useState(false);
    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [again, setAgain] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const post = async (body: object) => {
        const res = await fetch("/api/staff/password-reset", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        const out = await res.json().catch(() => ({})) as { error?: string };
        if (!res.ok) throw new Error(out.error || "Something went wrong. Please try again.");
    };

    const send = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true); setError("");
        try { await post({ email }); setSent(true); }
        catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
    };

    const reset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== again) { setError("The two passwords are not the same."); return; }
        setBusy(true); setError("");
        try {
            await post({ email, code, password });
            toast.success("Password changed. Sign in with the new one.");
            router.push(signInPath);
        } catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Reset your password</CardTitle>
                    <CardDescription>
                        {sent
                            ? `If ${email} has an account, a 6-digit code is on its way. It reaches the inbox set on your profile.`
                            : "We will email a 6-digit code to your staff address."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {!sent ? (
                        <form onSubmit={send} className="space-y-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="email">Staff email</Label>
                                <Input id="email" type="email" autoComplete="username" placeholder="name@networkservice.in"
                                    value={email} onChange={e => setEmail(e.target.value)} required />
                            </div>
                            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Sending…" : "Send code"}</Button>
                        </form>
                    ) : (
                        <form onSubmit={reset} className="space-y-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="code">Code from email</Label>
                                <Input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6 digits"
                                    value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="pw">New password</Label>
                                <Input id="pw" type="password" autoComplete="new-password" placeholder="Min 6 characters"
                                    value={password} onChange={e => setPassword(e.target.value)} required />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="pw2">Confirm password</Label>
                                <Input id="pw2" type="password" autoComplete="new-password" placeholder="Repeat new password"
                                    value={again} onChange={e => setAgain(e.target.value)} required />
                            </div>
                            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
                                {busy ? "Saving…" : "Set new password"}
                            </Button>
                            <button type="button" className="w-full text-center text-sm text-primary underline"
                                onClick={() => { setSent(false); setCode(""); setError(""); }}>
                                Send a new code
                            </button>
                        </form>
                    )}
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <p className="text-center text-sm text-muted-foreground">
                        <Link href={signInPath} className="text-primary underline">Back to sign in</Link>
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

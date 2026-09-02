"use client";

import { signIn, signOut, getSession } from "next-auth/react";
import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";
import { getLocalCounterSetup, isWebCounterBound, reconcileCounterSetup } from "@/shared/lib/counter/setupGate";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function StaffLoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/office/work-flow-inbox";
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        const res = await signIn("credentials-staff", {
            email,
            password,
            redirect: false,
        });

        if (res?.error) {
            // A PC with no counter has an empty replica, so the user lookup goes to the
            // cloud — offline, that fails and reads as a wrong password. Say what it is:
            // this machine must be online to bind a counter before it can sign in offline.
            const unbound = isElectronEnvironment() && !(await getLocalCounterSetup());
            setError(unbound
                ? "Sign-in failed. This PC is not set up as a counter yet, so it needs the internet to sign in and bind a counter. Check the connection, or the email and password."
                : "Invalid email or password");
            setLoading(false);
        } else {
            const dest = callbackUrl.startsWith("/") ? callbackUrl : "/office/work-flow-inbox";

            // ── Is this machine a counter? ──────────────────────────────────────
            // Desktop app: the local file plus the counter row (one DB read when
            // online, the replica when offline). Web version: is the local bridge's id
            // bound to a counter in the DB. The two ids are never cross-matched.
            const electron = isElectronEnvironment();
            let isCounter: boolean;
            if (electron) {
                // A PC with no local file short-circuits to "not-set-up" without fetching.
                const status = await reconcileCounterSetup(true);
                // Released: reset the PC — no counter, no local data (replicaWipe.ts).
                if (status === "released") await window.electronAPI?.clearCounterSetup?.();
                // "unreachable" — the replica could not answer; trust the file, the
                // readiness gate keeps the app covered until it can.
                isCounter = status === "valid" || status === "unreachable";
            } else {
                isCounter = await isWebCounterBound();
            }

            // ── Not a counter: only "login outside counter" may proceed ─────────
            // Same rule for both versions. On the desktop app this is also who may
            // onboard a fresh PC — setting up a counter is an office action, not a
            // cashier's.
            if (!isCounter) {
                const session = await getSession();
                const perms = (session?.user as { permissions?: string[] })?.permissions ?? [];
                if (!hasPermissionWithScope(perms, PERMISSIONS.AUTH_LOGIN_OUTSIDE_COUNTER)) {
                    await signOut({ redirect: false });
                    setError(electron
                        ? "This PC is not set up as a counter yet. Only a user with 'Can login outside counter' permission can sign in here to set it up."
                        : "This machine is not a counter. Contact admin to grant 'Can login outside counter' permission.");
                    setLoading(false);
                    return;
                }
                // Desktop app with no counter: onboarding, online only.
                if (electron) {
                    router.push(`/setup/counter?next=${encodeURIComponent(dest)}`);
                    return;
                }
            }

            router.push(dest);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle className="text-center">Service Management</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Password</Label>
                            <Input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                        {error && <p className="text-red-500 text-sm">{error}</p>}
                        <Button type="submit" disabled={loading} className="w-full">
                            {loading ? "Signing in..." : "Sign In"}
                        </Button>
                    </form>
                    <p className="mt-4 text-center text-sm text-muted-foreground">
                        Customer?{" "}
                        <Link href="/login" className="text-primary underline">
                            Sign in here
                        </Link>
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

export default function StaffLoginPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4 text-muted-foreground text-sm">
                    Loading…
                </div>
            }
        >
            <StaffLoginForm />
        </Suspense>
    );
}

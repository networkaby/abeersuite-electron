"use client";

import { signIn, signOut, getSession } from "next-auth/react";
import { isBridgeAvailable } from "@/shared/lib/bridge";
import { isElectronEnvironment } from "@/shared/lib/bridge/bridgeHealth";
import { getLocalCounterSetup, reconcileCounterSetup } from "@/shared/lib/counter/setupGate";
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
            // Counter-machine gate: non-counter machines may only log in
            // when the user holds auth:login:outside-counter.
            const bridgePresent = await isBridgeAvailable();
            if (!bridgePresent) {
                const session = await getSession();
                const perms = (session?.user as { permissions?: string[] })?.permissions ?? [];
                if (!hasPermissionWithScope(perms, PERMISSIONS.AUTH_LOGIN_OUTSIDE_COUNTER)) {
                    await signOut({ redirect: false });
                    setError(
                        "This machine is not a counter. " +
                        "Contact admin to grant 'Can login outside counter' permission."
                    );
                    setLoading(false);
                    return;
                }
            }
            const dest = callbackUrl.startsWith("/") ? callbackUrl : "/office/work-flow-inbox";

            // The counter self-check, before the session is used. First-launch setup,
            // or a counter an admin has since released — both send this machine
            // through /setup/counter instead of straight to dest. Never blocks a
            // non-Electron login (office staff, Vercel).
            if (isElectronEnvironment()) {
                // Replica only, offline or online — no cloud call. A PC with no local
                // file short-circuits to "not-set-up" without fetching at all.
                const status = await reconcileCounterSetup();
                if (status === "released") {
                    // Also resets the PC: no counter, no local data (replicaWipe.ts).
                    await window.electronAPI?.clearCounterSetup?.();
                }
                if (status === "not-set-up" || status === "released") {
                    router.push(`/setup/counter?next=${encodeURIComponent(dest)}`);
                    return;
                }
                // "valid" — unchanged. "reassigned" — already self-healed inside
                // reconcileCounterSetup (local cache + title rewritten). "unreachable"
                // — replica not ready yet, trust the local file. All three proceed.
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

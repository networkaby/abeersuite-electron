"use client";

import { signIn, signOut, getSession } from "next-auth/react";
import { isBridgeAvailable } from "@/shared/lib/bridge";
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
            setError("Invalid email or password");
            setLoading(false);
        } else {
            // Counter-machine gate: non-counter machines may only log in
            // when the user holds auth:login:outside-counter.
            const bridgePresent = await isBridgeAvailable();
            if (!bridgePresent) {
                const session = await getSession();
                const perms = (session?.user as { permissions?: string[] })?.permissions ?? [];
                if (!perms.includes("auth:login:outside-counter")) {
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

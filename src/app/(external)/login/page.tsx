"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function CustomerLoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/portal";

    const [tab, setTab] = useState<"mobile" | "email">("mobile");
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        const res = await signIn("credentials-portal", {
            identifier,
            password,
            redirect: false,
        });

        if (res?.error) {
            setError("Invalid mobile/email or password");
            setLoading(false);
        } else {
            router.push(callbackUrl.startsWith("/") ? callbackUrl : "/portal");
            router.refresh();
        }
    };

    return (
        <div className="min-h-[60vh] flex items-center justify-center px-4 py-10">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Customer sign in</CardTitle>
                    <CardDescription>Use the mobile number or email you registered with.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-2 mb-4">
                        <Button
                            type="button"
                            variant={tab === "mobile" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setTab("mobile")}
                        >
                            Mobile
                        </Button>
                        <Button
                            type="button"
                            variant={tab === "email" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setTab("email")}
                        >
                            Email
                        </Button>
                    </div>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label>{tab === "mobile" ? "Mobile" : "Email"}</Label>
                            <Input
                                type={tab === "mobile" ? "tel" : "email"}
                                autoComplete={tab === "mobile" ? "tel" : "email"}
                                value={identifier}
                                onChange={(e) => setIdentifier(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Password</Label>
                            <Input
                                type="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                        {error && <p className="text-sm text-destructive">{error}</p>}
                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? "Signing in…" : "Sign in"}
                        </Button>
                    </form>
                    <p className="mt-4 text-center text-sm text-muted-foreground">
                        No account?{" "}
                        <Link href="/portal/register" className="text-primary underline">
                            Register
                        </Link>
                    </p>
                    <p className="mt-2 text-center text-sm text-muted-foreground">
                        Staff?{" "}
                        <Link href="/staff/login" className="text-primary underline">
                            Staff sign in
                        </Link>
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

export default function CustomerLoginPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-[60vh] flex items-center justify-center px-4 py-10 text-muted-foreground text-sm">
                    Loading…
                </div>
            }
        >
            <CustomerLoginForm />
        </Suspense>
    );
}

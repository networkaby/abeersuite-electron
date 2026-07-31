"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LegalConsentNote from "@/modules/external/legal/LegalConsentNote";

export default function PortalRegisterPage() {
    const router = useRouter();
    const [tab, setTab] = useState<"mobile" | "email">("mobile");
    const [name, setName] = useState("");
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        try {
            await axios.post("/api/portal/register", {
                mode: tab,
                identifier,
                password,
                name: name.trim() || undefined,
            });
            router.push("/login");
        } catch (err: unknown) {
            const msg =
                axios.isAxiosError(err) && err.response?.data && typeof err.response.data === "object"
                    ? (err.response.data as { error?: string }).error
                    : null;
            setError(msg || "Registration failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-[60vh] flex items-center justify-center px-4 py-10">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Create portal account</CardTitle>
                    <CardDescription>
                        We link you to an existing customer record by mobile or email when possible.
                    </CardDescription>
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
                            <Label>Name (optional)</Label>
                            <Input value={name} onChange={(e) => setName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>{tab === "mobile" ? "Mobile" : "Email"}</Label>
                            <Input
                                type={tab === "mobile" ? "tel" : "email"}
                                value={identifier}
                                onChange={(e) => setIdentifier(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Password</Label>
                            <Input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                minLength={6}
                                required
                            />
                        </div>
                        {error && <p className="text-sm text-destructive">{error}</p>}
                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? "Creating…" : "Register"}
                        </Button>
                    </form>
                    <p className="mt-4 text-center text-sm text-muted-foreground">
                        <Link href="/login" className="text-primary underline">
                            Already have an account?
                        </Link>
                    </p>
                    <div className="mt-3">
                        <LegalConsentNote action="creating an account" />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

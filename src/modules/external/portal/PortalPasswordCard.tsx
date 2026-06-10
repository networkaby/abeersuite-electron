"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PortalPasswordCard() {
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const minLengthOk = newPassword.length >= 8;
    const hasMixed = /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword);
    const hasNumber = /\d/.test(newPassword);
    const hasSymbol = /[^A-Za-z0-9]/.test(newPassword);
    const score = [minLengthOk, hasMixed, hasNumber, hasSymbol].filter(Boolean).length;
    const scoreText = ["Weak", "Weak", "Fair", "Good", "Strong"][score];

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            toast.error("New password and confirm password do not match");
            return;
        }

        setLoading(true);
        try {
            await axios.patch("/api/portal/password", { currentPassword, newPassword });
            toast.success("Password updated");
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
        } catch (error) {
            toast.error(extractApiError(error, "Failed to update password"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card className="border-border/70 shadow-sm">
            <CardHeader className="border-b border-border/70 pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                    <ShieldCheck className="size-4 text-emerald-600" />
                    Security
                </CardTitle>
                <CardDescription>Change your portal password and keep your account safe.</CardDescription>
            </CardHeader>
            <CardContent>
                <form className="space-y-4 pt-2" onSubmit={onSubmit}>
                    <div className="space-y-1.5">
                        <Label htmlFor="currentPassword">Current password</Label>
                        <Input
                            id="currentPassword"
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            required
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="newPassword">New password</Label>
                        <Input
                            id="newPassword"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            minLength={8}
                            required
                        />
                        <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Strength</span>
                                <span className="font-medium">{scoreText}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted">
                                <div
                                    className="h-full rounded-full bg-primary transition-all"
                                    style={{ width: `${(score / 4) * 100}%` }}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="confirmPassword">Confirm new password</Label>
                        <Input
                            id="confirmPassword"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            minLength={8}
                            required
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">Use at least 8 characters with upper/lower case, number, and symbol.</p>
                    <Button type="submit" disabled={loading} className="w-full sm:w-auto">
                        {loading ? "Updating..." : "Update password"}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}


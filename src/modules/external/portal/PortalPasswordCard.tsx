"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PortalPasswordCard() {
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);

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
            toast.error(
                axios.isAxiosError(error) ? error.response?.data?.error ?? "Failed to update password" : "Failed to update password"
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Security</CardTitle>
                <CardDescription>Update your portal password to complete your profile security.</CardDescription>
            </CardHeader>
            <CardContent>
                <form className="space-y-4" onSubmit={onSubmit}>
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
                            minLength={6}
                            required
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="confirmPassword">Confirm new password</Label>
                        <Input
                            id="confirmPassword"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            minLength={6}
                            required
                        />
                    </div>
                    <Button type="submit" disabled={loading}>
                        {loading ? "Updating..." : "Update password"}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}


"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { extractApiError } from "@/shared/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
    customerId: number;
};

function generateTempPassword() {
    return `Temp${Math.random().toString(36).slice(2, 10)}!`;
}

export default function CustomerEmergencyPasswordResetCard({ customerId }: Props) {
    const [tempPassword, setTempPassword] = useState(generateTempPassword());
    const [saving, setSaving] = useState(false);

    const handleReset = async () => {
        if (tempPassword.trim().length < 6) {
            toast.error("Temporary password must be at least 6 characters");
            return;
        }

        setSaving(true);
        try {
            await axios.patch(`/api/person/${customerId}/portal-password`, {
                tempPassword: tempPassword.trim(),
            });
            toast.success("Emergency portal password reset successful");
        } catch (error) {
            toast.error(extractApiError(error, "Emergency reset failed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="border-amber-200 bg-amber-50/30 dark:border-amber-900/40 dark:bg-amber-950/20">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm">Emergency Portal Password Reset</CardTitle>
                <CardDescription>
                    Set a temporary password for this customer. Share it securely and ask customer to change after login.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="space-y-1.5">
                    <Label htmlFor="tempPassword">Temporary password</Label>
                    <Input
                        id="tempPassword"
                        value={tempPassword}
                        onChange={(e) => setTempPassword(e.target.value)}
                        autoComplete="off"
                    />
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={() => setTempPassword(generateTempPassword())}>
                        Generate new
                    </Button>
                    <Button type="button" onClick={() => void handleReset()} disabled={saving}>
                        {saving ? "Resetting..." : "Reset now"}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}


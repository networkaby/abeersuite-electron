"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import PortalSetPasswordFlow from "@/modules/external/portal/PortalSetPasswordFlow";

/**
 * Forgotten password. Same two steps as creating an account — verify, then set
 * — so it reuses that flow rather than growing a second copy of it.
 */
export default function PortalForgotPasswordPage() {
    return (
        <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Reset your password</CardTitle>
                    <CardDescription>
                        Get a one-time code on your mobile or email, then pick a new password.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <PortalSetPasswordFlow mode="reset" />
                    <p className="text-center text-sm text-muted-foreground">
                        <Link href="/login" className="text-primary underline">
                            Back to sign in
                        </Link>
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

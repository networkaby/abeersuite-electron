"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import LegalConsentNote from "@/modules/external/legal/LegalConsentNote";
import PortalSetPasswordFlow from "@/modules/external/portal/PortalSetPasswordFlow";
import { isSafeLandingPage } from "@/shared/lib/appModeCore";

/**
 * Create a portal account with a password.
 *
 * The mobile/email is verified by OTP first. It has to be: this page links the
 * new login to an existing customer record by number, so without proof of
 * ownership anyone could claim someone else's orders and invoices.
 *
 * Customers who never want a password can skip this entirely — /login signs
 * them in on the OTP alone and creates the account on the way through.
 */
export default function PortalRegisterPage() {
    return (
        <Suspense>
            <PortalRegister />
        </Suspense>
    );
}

function PortalRegister() {
    const raw = useSearchParams().get("callbackUrl") ?? "";
    const callbackUrl = isSafeLandingPage(raw) ? raw : null;
    return (
        <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Create portal account</CardTitle>
                    <CardDescription>
                        We link you to your existing orders and repairs by mobile or email.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <PortalSetPasswordFlow mode="register" returnTo={callbackUrl ?? undefined} />
                    <p className="text-center text-sm text-muted-foreground">
                        <Link
                            href={callbackUrl ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login"}
                            className="text-primary underline">
                            Already have an account?
                        </Link>
                    </p>
                    <LegalConsentNote action="creating an account" />
                </CardContent>
            </Card>
        </div>
    );
}

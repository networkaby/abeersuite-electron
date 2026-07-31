"use client";

import { signIn } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileText, KeyRound, MessageSquareLock, ShieldCheck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LegalConsentNote from "@/modules/external/legal/LegalConsentNote";
import PortalOnboardForm from "@/modules/external/portal/PortalOnboardForm";
import PortalOtpLoginForm, { type OtpStep } from "@/modules/external/portal/PortalOtpLoginForm";
import { usePortalPasswordlessSignIn } from "@/modules/external/portal/usePortalPasswordlessSignIn";
import { signInWithGoogle } from "@/shared/lib/auth/portalPasswordless";
import { HERO_SLIDES } from "@/shared/lib/shop/storeContent";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

/**
 * Backdrop photo — reuses the storefront hero imagery so the login matches the
 * landing page. Swap the index (or the whole registry entry) to change it.
 */
const BACKDROP = HERO_SLIDES[0];

/** Why a customer signs in — portal benefits, not storefront shipping blurb. */
const PORTAL_PERKS = [
    { icon: Wrench, text: "Track your repairs live" },
    { icon: FileText, text: "All orders, invoices & warranties in one place" },
    { icon: ShieldCheck, text: "Secure OTP sign-in — no password to remember" },
];

/** Official multicolour Google "G". */
function GoogleIcon() {
    return (
        <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="#4285F4"
                d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81Z"
            />
            <path
                fill="#34A853"
                d="M12 24c3.24 0 5.96-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.14-4.06 1.14-3.12 0-5.77-2.11-6.71-4.95H1.29v3.1A12 12 0 0 0 12 24Z"
            />
            <path
                fill="#FBBC05"
                d="M5.29 14.28a7.22 7.22 0 0 1 0-4.56v-3.1H1.29a12 12 0 0 0 0 10.76l4-3.1Z"
            />
            <path
                fill="#EA4335"
                d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.44-3.44A11.98 11.98 0 0 0 1.29 6.62l4 3.1C6.23 6.88 8.88 4.77 12 4.77Z"
            />
        </svg>
    );
}

function CustomerLoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const rawCallback = searchParams.get("callbackUrl") ?? "";
    const callbackUrl = rawCallback.startsWith("/") && !rawCallback.startsWith("//") ? rawCallback : "/portal";

    const [method, setMethod] = useState<"otp" | "password">("otp");
    // One field for mobile OR email — the server works out which it is.
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [pwError, setPwError] = useState("");
    const [loading, setLoading] = useState(false);

    const goToPortal = () => {
        router.push(callbackUrl);
        router.refresh();
    };

    const passwordless = usePortalPasswordlessSignIn(goToPortal);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setPwError("");

        const res = await signIn("credentials-portal", {
            identifier,
            password,
            redirect: false,
        });

        if (res?.error) {
            setPwError("Invalid mobile/email or password");
            setLoading(false);
        } else {
            goToPortal();
        }
    };

    const handleGoogle = async () => {
        passwordless.setError("");
        try {
            const idToken = await signInWithGoogle();
            await passwordless.submitToken(idToken, "email", "your Google account");
        } catch (e) {
            passwordless.setError(
                e instanceof Error ? e.message : "Google sign-in failed. Please try again."
            );
        }
    };

    // Visual-review aid only: ?uiPreview=code|onboard renders a later step so
    // the layout can be checked before the providers are wired. It grants
    // nothing — a session still needs a real verified token.
    const uiPreview = searchParams.get("uiPreview");
    const previewOnboard = uiPreview === "onboard";
    const previewStep: OtpStep = uiPreview === "code" ? "code" : "identify";

    const onboard = passwordless.onboard;
    const onboarding = onboard !== null || previewOnboard;

    return (
        // Mobile-first: one centred column over a photo backdrop. From lg the
        // brand panel sits beside the card and the overlay lightens to the right
        // so more of the photo shows through.
        <div className="relative isolate min-h-dvh w-full overflow-hidden">
            <Image
                src={BACKDROP.imageUrl}
                alt=""
                fill
                priority
                sizes="100vw"
                className="-z-10 object-cover"
            />
            {/* Overlay keeps text readable in both light and dark themes. */}
            <div
                aria-hidden
                className="absolute inset-0 -z-10 bg-linear-to-b from-background/95 via-background/85 to-background/95 lg:bg-linear-to-r lg:from-background/95 lg:via-background/80 lg:to-background/45"
            />

            <div className="mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-8 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:gap-12 lg:py-16">
                {/* Brand panel — compact on mobile, full pitch from lg. */}
                <div className="space-y-5 text-center lg:text-left">
                    <Link
                        href="/"
                        // py keeps the tap target ~44px tall on phones even though
                        // the wordmark itself is only 32px.
                        className="inline-flex py-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        {/* The wordmark already reads as the brand name, so `alt` carries
                            it and there is no duplicate text label beside it.
                            width/height only set the 3.44:1 intrinsic ratio; CSS drives
                            the real size. `unoptimized` skips the image optimizer — a
                            single-path vector has nothing to re-encode. */}
                        <Image
                            src="/logo.svg"
                            alt={COMPANY_DETAILS.brandName}
                            width={344}
                            height={100}
                            priority
                            unoptimized
                            className="h-8 w-auto lg:h-11"
                        />
                    </Link>
                    <h1 className="hidden text-3xl font-bold tracking-tight lg:block xl:text-4xl">
                        Your orders, repairs and invoices — all in one place.
                    </h1>
                    <p className="mx-auto max-w-sm text-sm text-muted-foreground lg:mx-0 lg:text-base">
                        {COMPANY_DETAILS.tagline}
                    </p>
                    <ul className="hidden space-y-3 lg:block">
                        {PORTAL_PERKS.map(({ icon: Icon, text }) => (
                            <li key={text} className="flex items-center gap-3 text-sm">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
                                    <Icon className="size-4" />
                                </span>
                                {text}
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Sign-in column */}
                <div className="mx-auto w-full max-w-md space-y-4 lg:mx-0 lg:ml-auto">
                    <Card className="border-border/60 bg-card/95 shadow-xl backdrop-blur-sm supports-backdrop-filter:bg-card/80">
                        <CardHeader className="text-center space-y-1">
                            <CardTitle className="text-2xl">
                                {onboarding ? "Almost there" : "Welcome back"}
                            </CardTitle>
                            <CardDescription>
                                {onboarding
                                    ? "We could not find an account, so let us create one."
                                    : method === "otp"
                                        ? "Get a one-time code on your mobile or email — no password needed."
                                        : "Sign in with your mobile number or email."}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            {onboarding ? (
                                <PortalOnboardForm
                                    channel={onboard?.channel ?? "mobile"}
                                    identity={onboard?.identity ?? "+91 ••••• 43210"}
                                    busy={passwordless.busy}
                                    error={passwordless.error}
                                    onSubmit={passwordless.completeOnboard}
                                    onCancel={passwordless.cancelOnboard}
                                />
                            ) : (
                                <>
                                    {/* Method switch */}
                                    <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                                        <Button
                                            type="button"
                                            variant={method === "otp" ? "default" : "ghost"}
                                            size="sm"
                                            className="gap-1.5"
                                            onClick={() => {
                                                setMethod("otp");
                                                setPwError("");
                                            }}
                                        >
                                            <MessageSquareLock className="hidden size-4 shrink-0 sm:block" />
                                            <span className="truncate">Mobile or Email OTP</span>
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={method === "password" ? "default" : "ghost"}
                                            size="sm"
                                            className="gap-1.5"
                                            onClick={() => {
                                                setMethod("password");
                                                passwordless.setError("");
                                            }}
                                        >
                                            <KeyRound className="hidden size-4 shrink-0 sm:block" />
                                            <span className="truncate">Password</span>
                                        </Button>
                                    </div>

                                    {method === "otp" ? (
                                        <PortalOtpLoginForm
                                            onVerified={passwordless.submitToken}
                                            busy={passwordless.busy}
                                            submitError={passwordless.error}
                                            initialStep={previewStep}
                                        />
                                    ) : (
                                        <form onSubmit={handleSubmit} className="space-y-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="login-identifier">Mobile or email</Label>
                                                <Input
                                                    id="login-identifier"
                                                    type="text"
                                                    autoComplete="username"
                                                    placeholder="98765 43210 or you@example.com"
                                                    value={identifier}
                                                    onChange={(e) => setIdentifier(e.target.value)}
                                                    required
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="login-password">Password</Label>
                                                <Input
                                                    id="login-password"
                                                    type="password"
                                                    autoComplete="current-password"
                                                    placeholder="••••••••"
                                                    value={password}
                                                    onChange={(e) => setPassword(e.target.value)}
                                                    required
                                                />
                                            </div>
                                            {pwError && <p className="text-sm text-destructive">{pwError}</p>}
                                            <Button type="submit" className="w-full" disabled={loading}>
                                                {loading ? "Signing in…" : "Sign in"}
                                            </Button>
                                        </form>
                                    )}

                                    {/* Divider */}
                                    <div className="relative">
                                        <div className="absolute inset-0 flex items-center">
                                            <span className="w-full border-t" />
                                        </div>
                                        <div className="relative flex justify-center text-xs uppercase">
                                            <span className="bg-card px-2 text-muted-foreground">
                                                or continue with
                                            </span>
                                        </div>
                                    </div>

                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="w-full gap-2"
                                        disabled={passwordless.busy}
                                        onClick={() => void handleGoogle()}
                                    >
                                        <GoogleIcon />
                                        Google
                                    </Button>
                                    {method === "password" && passwordless.error && (
                                        <p className="text-sm text-destructive">{passwordless.error}</p>
                                    )}
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {!onboarding && (
                        <p className="text-center text-sm text-muted-foreground">
                            New here?{" "}
                            <Link
                                href="/portal/register"
                                className="font-medium text-primary underline-offset-4 hover:underline"
                            >
                                Create an account
                            </Link>
                        </p>
                    )}

                    <LegalConsentNote action={onboarding ? "creating an account" : "signing in"} />
                </div>
            </div>
        </div>
    );
}

export default function CustomerLoginPage() {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-dvh items-center justify-center px-4 py-10 text-sm text-muted-foreground">
                    Loading…
                </div>
            }
        >
            <CustomerLoginForm />
        </Suspense>
    );
}

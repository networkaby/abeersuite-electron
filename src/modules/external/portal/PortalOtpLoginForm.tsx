"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WhatsAppIcon } from "@/shared/components/WhatsAppIcon";
import { isLikelyEmail, normalizeMobile10, normalizePortalEmail } from "@/shared/lib/auth/portalIdentifier";
import { sendOtp, type OtpChannel, type OtpConfirmation, type OtpDelivery } from "@/shared/lib/auth/portalPasswordless";

const RESEND_SECONDS = 30;

/** identify → code. Same two steps whether the code came by SMS or email. */
export type OtpStep = "identify" | "code";

/** Show the last 4 digits only, so the customer can check they typed it right. */
function maskPhone(digits: string): string {
    return digits.length <= 4 ? digits : `${"•".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** rahul@example.com → r••••@example.com */
function maskEmail(email: string): string {
    const [user, domain] = email.split("@");
    if (!domain) return email;
    const shown = user.slice(0, 1);
    return `${shown}${"•".repeat(Math.max(user.length - 1, 1))}@${domain}`;
}

export default function PortalOtpLoginForm({
    onVerified,
    busy: parentBusy,
    submitError,
    initialStep = "identify",
    lockedIdentifier,
    verifyLabel = "Verify & sign in",
}: {
    /** Called with a verified token from whichever channel was used. */
    onVerified: (token: string, channel: OtpChannel, identity: string) => void;
    busy: boolean;
    submitError: string;
    initialStep?: OtpStep;
    /**
     * Verify THIS contact (My Profile → Verify): the field is pre-filled and
     * read-only, so the code can only go to the contact being verified.
     */
    lockedIdentifier?: string;
    /** Button text on the code step — "sign in" reads wrong on a profile page. */
    verifyLabel?: string;
}) {
    const [step, setStep] = useState<OtpStep>(initialStep);
    // One field for mobile OR email — we work out which it is.
    const [identifier, setIdentifier] = useState(lockedIdentifier ?? "");
    const [code, setCode] = useState("");
    const [error, setError] = useState("");
    const [sending, setSending] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const confirmation = useRef<OtpConfirmation | null>(null);
    // Where the last code went — the server picks WhatsApp or SMS per send.
    const [via, setVia] = useState<OtpDelivery>("whatsapp");

    const busy = sending || parentBusy;
    const asEmail = isLikelyEmail(identifier);
    // Same 10-digit rule the send route applies, so the error shows before
    // we spend a WhatsApp/SMS message on a number that cannot receive one.
    const digits = normalizeMobile10(identifier);
    const channel: OtpChannel = asEmail ? "email" : "mobile";
    // Shown back to the customer. The value the server actually verifies comes
    // out of the OTP ticket, so this is for display only.
    const displayIdentity = asEmail
        ? normalizePortalEmail(identifier)
        : `+91 ${digits ?? ""}`;
    const maskedIdentity = asEmail
        ? maskEmail(normalizePortalEmail(identifier))
        : `+91 ${maskPhone(digits ?? "")}`;

    // Resend countdown.
    useEffect(() => {
        if (cooldown <= 0) return;
        const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
        return () => clearTimeout(t);
    }, [cooldown]);

    const send = async () => {
        setError("");
        if (!asEmail && !digits) {
            setError("Enter a valid 10-digit mobile number, or an email address");
            return;
        }
        setSending(true);
        try {
            // One endpoint for both channels — the server normalizes the
            // identifier and picks SMS or email.
            confirmation.current = await sendOtp(identifier.trim());
            setVia(confirmation.current.via);
            setStep("code");
            setCode("");
            setCooldown(RESEND_SECONDS);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not send the code. Please try again.");
        } finally {
            setSending(false);
        }
    };

    const verify = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!confirmation.current) return;
        setSending(true);
        setError("");
        try {
            const token = await confirmation.current.confirm(code);
            onVerified(token, channel, displayIdentity);
        } catch (err) {
            setError(err instanceof Error ? err.message : "That code did not match. Please check and retry.");
        } finally {
            setSending(false);
        }
    };

    const restart = () => {
        setStep("identify");
        setError("");
        setCode("");
        confirmation.current = null;
    };

    // ── Step 1: one field, mobile or email ──────────────────────────────────
    if (step === "identify") {
        return (
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="otp-identifier">Mobile or email</Label>
                    <Input
                        id="otp-identifier"
                        type="text"
                        autoComplete="username"
                        placeholder="98765 43210 or you@example.com"
                        value={identifier}
                        readOnly={!!lockedIdentifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                void send();
                            }
                        }}
                    />
                    <p className="text-xs text-muted-foreground">
                        {asEmail
                            ? "We will email you a 6-digit code. No password needed."
                            : (
                                  <>
                                      We will send a 6-digit code on{" "}
                                      <WhatsAppIcon className="size-3.5 align-[-2px]" />{" "}
                                      <span className="font-medium text-foreground">WhatsApp</span>. No password needed.
                                  </>
                              )}
                    </p>
                </div>
                {(error || submitError) && (
                    <p className="text-sm text-destructive">{error || submitError}</p>
                )}
                <Button
                    type="button"
                    className="w-full"
                    disabled={busy || identifier.trim().length === 0}
                    onClick={() => void send()}
                >
                    {busy ? "Sending…" : "Send code"}
                </Button>
            </div>
        );
    }

    // ── Step 2: code entry — identical for SMS and email ────────────────────
    return (
        <form onSubmit={verify} className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="otp-code">Enter the 6-digit code</Label>
                <Input
                    id="otp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="••••••"
                    className="text-center text-lg tracking-[0.5em]"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    autoFocus
                />
                <p className="text-xs text-muted-foreground">
                    {via === "whatsapp" ? (
                        <>
                            Check <WhatsAppIcon className="size-4 align-[-3px]" />{" "}
                            <span className="font-medium text-foreground">WhatsApp</span> on {maskedIdentity}
                        </>
                    ) : via === "sms" ? (
                        <>
                            Check your <span className="font-medium text-foreground">text messages (SMS)</span> on{" "}
                            {maskedIdentity}
                        </>
                    ) : (
                        <>Sent to {maskedIdentity} by email</>
                    )}
                </p>
            </div>
            {(error || submitError) && <p className="text-sm text-destructive">{error || submitError}</p>}
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
                {busy ? "Verifying…" : verifyLabel}
            </Button>
            <div className="flex items-center justify-between text-sm">
                {lockedIdentifier ? <span /> : (
                    <button type="button" className="text-primary underline" onClick={restart}>
                        {asEmail ? "Change email" : "Change number"}
                    </button>
                )}
                <button
                    type="button"
                    className="text-primary underline disabled:text-muted-foreground disabled:no-underline"
                    disabled={busy || cooldown > 0}
                    onClick={() => void send()}
                >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
            </div>
        </form>
    );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Mail, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WhatsAppIcon } from "@/shared/components/WhatsAppIcon";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { isLikelyEmail, normalizeMobile10, normalizePortalEmail } from "@/shared/lib/auth/portalIdentifier";
import { sendOtp, type OtpChannel, type OtpConfirmation, type OtpDelivery } from "@/shared/lib/auth/portalPasswordless";

const RESEND_SECONDS = 30;
/** A WhatsApp code still missing after this long → remind them to go online. */
const INTERNET_HINT_AFTER_SECONDS = 10;

/** identify → code. Same two steps whether the code came by WhatsApp or email. */
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
    // A WhatsApp code to a phone with no internet just waits on Meta's side, so
    // from the second send on the customer picks WhatsApp or SMS.
    const [smsAvailable, setSmsAvailable] = useState(false);
    // SMS sends so far on this screen — the server rotates providers by it.
    const smsTries = useRef(0);
    const [partner, setPartner] = useState<string | undefined>();

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

    const send = async (viaSms = false) => {
        setError("");
        if (!asEmail && !digits) {
            setError("Enter a valid 10-digit mobile number, or an email address");
            return;
        }
        setSending(true);
        try {
            // One endpoint for both channels — the server normalizes the
            // identifier and picks WhatsApp or email.
            confirmation.current = await sendOtp(
                identifier.trim(),
                viaSms ? { smsTry: smsTries.current } : undefined
            );
            if (confirmation.current.via === "sms") smsTries.current += 1;
            setVia(confirmation.current.via);
            setSmsAvailable(confirmation.current.smsAvailable);
            setPartner(confirmation.current.partner);
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
                    {!busy && identifier.trim() && (
                        // Logo of the channel the code will go by. A mobile goes on WhatsApp
                        // unless the last send fell back to SMS.
                        asEmail ? (
                            <Mail className="size-4" />
                        ) : via === "sms" ? (
                            <MessageSquareText className="size-4" />
                        ) : (
                            <WhatsAppIcon className="size-4" />
                        )
                    )}
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
                {/* Resend sits right under the code box, beside where the code went. */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                    <p className="text-muted-foreground">
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
                    {cooldown > 0 ? (
                        <span className="text-muted-foreground">Resend in {cooldown}s</span>
                    ) : asEmail || !smsAvailable ? (
                        <button
                            type="button"
                            className="text-primary underline disabled:text-muted-foreground"
                            disabled={busy}
                            onClick={() => void send()}
                        >
                            Resend code
                        </button>
                    ) : (
                        // Second send on: the customer chooses the pipe.
                        <span className="flex items-center gap-3">
                            <span className="text-muted-foreground">Resend on</span>
                            <button
                                type="button"
                                className="inline-flex items-center gap-1 text-primary underline disabled:text-muted-foreground"
                                disabled={busy}
                                onClick={() => void send()}
                            >
                                <WhatsAppIcon className="size-3.5" />
                                WhatsApp
                            </button>
                            <button
                                type="button"
                                className="inline-flex items-center gap-1 text-primary underline disabled:text-muted-foreground"
                                disabled={busy}
                                onClick={() => void send(true)}
                            >
                                <MessageSquareText className="size-3.5" />
                                SMS
                            </button>
                        </span>
                    )}
                </div>
                {via === "sms" && partner && (
                    <p className="text-xs text-muted-foreground">
                        It comes from our delivery partner{" "}
                        <span className="font-medium text-foreground">{partner}</span>, not from{" "}
                        {COMPANY_DETAILS.brandName} directly.
                    </p>
                )}
                {via === "whatsapp" && RESEND_SECONDS - cooldown >= INTERNET_HINT_AFTER_SECONDS && (
                    <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                        Not received yet? Turn on mobile data or Wi-Fi — WhatsApp codes arrive only
                        when your phone is online.
                    </p>
                )}
            </div>
            {(error || submitError) && <p className="text-sm text-destructive">{error || submitError}</p>}
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
                {busy ? "Verifying…" : verifyLabel}
            </Button>
            {!lockedIdentifier && (
                <div className="text-sm">
                    <button type="button" className="text-primary underline" onClick={restart}>
                        {asEmail ? "Change email" : "Change number"}
                    </button>
                </div>
            )}
        </form>
    );
}

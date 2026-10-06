import "server-only";

/**
 * SMS OTP delivery — the slot for a future SMS provider. Not wired to any
 * vendor yet, so mobile codes go on WhatsApp only.
 *
 * Fast2SMS was removed 2026-10-06: without our own DLT registration its only
 * route was ~Rs 5 per SMS, far above the Rs 0.30 ceiling. To add a provider,
 * fill in these two functions (and their env keys) — the send route, the
 * "check your texts" screen and the SMS icon already handle `via: "sms"`.
 *
 * Like WhatsApp, the vendor is a pipe: we generate the code and verify it
 * ourselves (see `otpChallenge.ts`).
 */

export class SmsNotConfiguredError extends Error {
    constructor(detail = "no SMS provider") {
        super(`SMS sending is not set up yet (${detail}).`);
        this.name = "SmsNotConfiguredError";
    }
}

export function isSmsConfigured(): boolean {
    return false;
}

/** Send a pre-generated OTP by SMS to a bare 10-digit Indian mobile number. */
export async function sendOtpSms(_mobile: string, _code: string): Promise<void> {
    throw new SmsNotConfiguredError();
}

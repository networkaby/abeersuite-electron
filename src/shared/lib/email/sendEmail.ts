import "server-only";

/**
 * Minimal transactional email sender — the project's first one.
 *
 * Talks to Resend's REST API over plain `fetch` rather than pulling in an SDK:
 * one endpoint, one JSON body, nothing to keep updated. Swapping vendor means
 * rewriting only `deliver()` below.
 *
 * Needs RESEND_API_KEY and EMAIL_FROM (a verified sender on your domain).
 */

export class EmailNotConfiguredError extends Error {
    constructor() {
        super("Email sending is not set up yet (RESEND_API_KEY / EMAIL_FROM missing).");
        this.name = "EmailNotConfiguredError";
    }
}

export function isEmailConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export type OutgoingEmail = {
    to: string;
    subject: string;
    /** Plain-text body — always send one; some clients prefer it. */
    text: string;
    html?: string;
    /** Extra mail headers — e.g. List-Unsubscribe on a marketing email. */
    headers?: Record<string, string>;
};

export async function sendEmail(msg: OutgoingEmail): Promise<void> {
    if (!isEmailConfigured()) throw new EmailNotConfiguredError();

    const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from: process.env.EMAIL_FROM,
            to: [msg.to],
            subject: msg.subject,
            text: msg.text,
            ...(msg.html ? { html: msg.html } : {}),
            ...(msg.headers ? { headers: msg.headers } : {}),
        }),
    });

    if (!res.ok) {
        // Surface the vendor's reason in logs, never to the customer.
        const detail = await res.text().catch(() => "");
        throw new Error(`Email send failed (${res.status}): ${detail.slice(0, 300)}`);
    }
}

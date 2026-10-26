import "server-only";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { EMAIL_TEMPLATE_DEFAULTS, OTP_MINUTES, emailBodyToHtml, fillEmail, type SecurityEmailKind } from "./emailTemplates";
import { getEmailTemplate } from "./emailTemplateStore";
import { sendEmail } from "./sendEmail";

/**
 * Send a sign-in / password-reset code with its template (Settings → Email
 * Templates → Sign-in & security). Always on. If the template cannot be read
 * the built-in wording is used — a database hiccup must never stop sign-in.
 * Throws like sendEmail when the email service refuses.
 */
export async function sendCodeEmail(kind: SecurityEmailKind, to: string, code: string): Promise<void> {
    const draft = await getEmailTemplate(kind)
        .then((t) => t.draft)
        .catch(() => EMAIL_TEMPLATE_DEFAULTS[kind]);
    const values = { code, minutes: String(OTP_MINUTES), shop: COMPANY_DETAILS.brandName };
    const text = fillEmail(draft.body, values);
    await sendEmail({ to, subject: fillEmail(draft.subject, values), text, html: emailBodyToHtml(text) });
}

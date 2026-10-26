import { ScrollArea } from "@/components/ui/scroll-area";
import { listEmailTemplates } from "@/shared/lib/email/emailTemplateStore";
import { isEmailConfigured } from "@/shared/lib/email/sendEmail";
import { EmailTemplatesPanel } from "@/modules/settings/components/EmailTemplatesPanel";

export const metadata = { title: "Email Templates" };

export default async function EmailTemplatesPage() {
    const templates = await listEmailTemplates();
    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-4 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-xl font-semibold">Email Templates</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        The email a customer gets for each bill, receipt, return, refund, order, estimate, repair update and due
                        reminder (together with the WhatsApp), plus the shop&apos;s own emails: abandoned cart, payment pending and
                        welcome; and the sign-in / password-reset code emails (always on). It goes only to the customer&apos;s <b>verified</b>
                        email. No approval needed — the saved wording is sent.
                    </p>
                </div>
                <EmailTemplatesPanel initialTemplates={templates} sendReady={isEmailConfigured()} />
            </div>
        </ScrollArea>
    );
}

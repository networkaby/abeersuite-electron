import { ScrollArea } from "@/components/ui/scroll-area";
import { listWaTemplates } from "@/shared/lib/whatsapp/waTemplateStore";
import { isBillSendConfigured, isTemplateApiConfigured } from "@/shared/lib/whatsapp/metaTemplates";
import { WhatsAppTemplatesPanel } from "@/modules/settings/components/WhatsAppTemplatesPanel";

export const metadata = { title: "WhatsApp Templates" };

export default async function WhatsAppTemplatesPage() {
    const templates = await listWaTemplates();
    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-4 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-xl font-semibold">WhatsApp Templates</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        The WhatsApp message a customer gets for a sale bill or a receipt — sent together with the
                        customer-app notification. WhatsApp only delivers wording Meta has <b>approved</b>: edit, then
                        <b> Send for approval</b>. Bills keep using the last approved wording until the new one is approved.
                    </p>
                </div>
                <WhatsAppTemplatesPanel
                    initialTemplates={templates}
                    templateApiReady={isTemplateApiConfigured()}
                    sendReady={isBillSendConfigured()}
                />
            </div>
        </ScrollArea>
    );
}

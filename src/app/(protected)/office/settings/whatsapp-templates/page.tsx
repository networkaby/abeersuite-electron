import { ScrollArea } from "@/components/ui/scroll-area";
import { listWaTemplatesFresh } from "@/shared/lib/whatsapp/waTemplateStore";
import { isBillSendConfigured, isTemplateApiConfigured } from "@/shared/lib/whatsapp/metaTemplates";
import { listWaNumberViews } from "@/shared/lib/whatsapp/waNumbers";
import { WhatsAppTemplatesPanel } from "@/modules/settings/components/WhatsAppTemplatesPanel";

export const metadata = { title: "WhatsApp Templates" };

export default async function WhatsAppTemplatesPage() {
    // Asks Meta about any card still waiting, so an approval shows on open.
    const [templates, numbers] = await Promise.all([listWaTemplatesFresh(), listWaNumberViews()]);
    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-4 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-xl font-semibold">WhatsApp Templates</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        The WhatsApp message a customer gets for each bill, receipt, return, refund, order, estimate and
                        repair update — sent together with the customer-app notification. WhatsApp only delivers wording Meta has <b>approved</b>: edit, then
                        <b> Send for approval</b>. Bills keep using the last approved wording until the new one is approved. Each WhatsApp account approves on its own, so a new account can be approved before bills move to it. Numbers are added in App Settings → WhatsApp numbers.
                    </p>
                </div>
                <WhatsAppTemplatesPanel
                    initialTemplates={templates}
                    numbers={numbers}
                    templateApiReady={await isTemplateApiConfigured()}
                    sendReady={await isBillSendConfigured()}
                />
            </div>
        </ScrollArea>
    );
}

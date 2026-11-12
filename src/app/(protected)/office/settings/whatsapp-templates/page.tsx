import { ScrollArea } from "@/components/ui/scroll-area";
import { listWaTemplatesFresh } from "@/shared/lib/whatsapp/waTemplateStore";
import { isBillSendConfigured, isTemplateApiConfigured } from "@/shared/lib/whatsapp/metaTemplates";
import { WhatsAppTemplatesPanel } from "@/modules/settings/components/WhatsAppTemplatesPanel";
import { WhatsAppConnectCard } from "@/modules/settings/components/WhatsAppConnectCard";

export const metadata = { title: "WhatsApp Templates" };

export default async function WhatsAppTemplatesPage() {
    // Asks Meta about any card still waiting, so an approval shows on open.
    const templates = await listWaTemplatesFresh();
    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-4 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-xl font-semibold">WhatsApp Templates</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        The WhatsApp message a customer gets for each bill, receipt, return, refund, order, estimate and
                        repair update — sent together with the customer-app notification. WhatsApp only delivers wording Meta has <b>approved</b>: edit, then
                        <b> Send for approval</b>. Bills keep using the last approved wording until the new one is approved.
                    </p>
                </div>
                <WhatsAppConnectCard />
                <WhatsAppTemplatesPanel
                    initialTemplates={templates}
                    templateApiReady={await isTemplateApiConfigured()}
                    sendReady={await isBillSendConfigured()}
                />
            </div>
        </ScrollArea>
    );
}

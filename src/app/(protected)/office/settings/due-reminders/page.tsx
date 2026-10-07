import { ScrollArea } from "@/components/ui/scroll-area";
import { DueRemindersPanel } from "@/modules/settings/components/DueRemindersPanel";

export const metadata = { title: "Due Reminders" };

export default function DueRemindersPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-5xl space-y-4 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-xl font-semibold">Due Reminders</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        WhatsApp and customer-app reminders for money due. Send to one customer or to all from the
                        <b> Receivables</b> report; set up the automatic rules here.
                    </p>
                </div>
                <DueRemindersPanel />
            </div>
        </ScrollArea>
    );
}

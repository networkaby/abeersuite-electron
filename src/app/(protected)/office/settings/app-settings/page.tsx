import { ScrollArea } from "@/components/ui/scroll-area";
import { AppSettingsForm } from "@/modules/settings/components/AppSettingsForm";

export const metadata = { title: "App Settings" };

export default function AppSettingsPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-8">
                <div>
                    <h1 className="text-xl font-semibold">App Settings</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Ids, keys and passwords for WhatsApp, Meta, couriers, payments and email. A value saved here wins; a blank box uses the server&apos;s .env value.
                        Secrets are saved scrambled and never shown back — only their last 4 characters. Move them to Vercel and clear them here when done testing.
                    </p>
                </div>
                <AppSettingsForm />
            </div>
        </ScrollArea>
    );
}

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
                        WhatsApp number ids and other plain ids. A value saved here wins; a blank box uses the server&apos;s .env value.
                        Tokens and secrets are never kept here — they stay in Vercel.
                    </p>
                </div>
                <AppSettingsForm />
            </div>
        </ScrollArea>
    );
}

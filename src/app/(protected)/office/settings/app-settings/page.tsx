import { ScrollArea } from "@/components/ui/scroll-area";
import { AppSettingsForm } from "@/modules/settings/components/AppSettingsForm";

export const metadata = { title: "App Settings" };

export default function AppSettingsPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-8">
                <div>
                    <h1 className="text-xl font-semibold">App Settings</h1>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                        A value saved here wins; an empty box uses the server&apos;s .env. Secrets are stored scrambled and show only their last 4 characters.
                    </p>
                </div>
                <AppSettingsForm />
            </div>
        </ScrollArea>
    );
}

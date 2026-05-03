import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import PortalAccountSwitcher from "@/modules/external/portal/PortalAccountSwitcher";
import PortalPasswordCard from "@/modules/external/portal/PortalPasswordCard";
import { Settings } from "lucide-react";

export default async function PortalSettingsPage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    if (!session?.user || kind !== "customer") {
        redirect("/login?callbackUrl=/portal/settings");
    }

    return (
        <main className="px-4 py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-5xl space-y-5">
                <PortalSectionHeader
                    title="Profile Settings"
                    description="Manage active profile context and account security."
                    icon={Settings}
                />
                <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
                    <PortalAccountSwitcher />
                    <PortalPasswordCard />
                </div>
                <Card className="border-border/70">
                    <CardContent className="p-4 text-sm text-muted-foreground">
                        Phase 2 will add edit profile details, notification preferences, privacy controls, and session management.
                    </CardContent>
                </Card>
            </div>
        </main>
    );
}


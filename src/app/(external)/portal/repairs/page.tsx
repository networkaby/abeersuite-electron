import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import { Wrench } from "lucide-react";
import { loadPortalRepairs } from "@/modules/external/portal/portalRepairs";
import { resolveActivePortalAccount } from "@/shared/lib/auth/portalActiveAccount";

export default async function PortalRepairsPage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    if (!session?.user || kind !== "customer") {
        redirect("/login?callbackUrl=/portal/repairs");
    }

    const customerId = parseInt((session.user as { customerId?: string }).customerId || "", 10);
    if (!Number.isFinite(customerId)) redirect("/login");

    const context = await resolveActivePortalAccount(customerId);
    if (!context) redirect("/portal");

    const tickets = await loadPortalRepairs(context.active.accountId);

    return (
        <main className="px-3 py-4 sm:px-4 sm:py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-5xl space-y-5">
                <PortalSectionHeader
                    title="My Repairs"
                    description="Track active service tickets and latest progress updates."
                    icon={Wrench}
                />
                <Card className="border-border/70">
                    <CardContent className="p-4 text-sm text-muted-foreground">
                        Active profile: <span className="font-medium text-foreground">{context.active.label}</span>
                    </CardContent>
                </Card>

                {tickets.length === 0 ? (
                    <Card>
                        <CardContent className="py-14 text-center text-sm text-muted-foreground">
                            No repair tickets found for this profile.
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-3">
                        {tickets.map((ticket) => (
                            <Card key={ticket.id} className="border-border/70">
                                <CardContent className="p-4 sm:p-5">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <p className="font-medium">Ticket #{ticket.id}</p>
                                            <p className="text-xs text-muted-foreground">{ticket.device}</p>
                                        </div>
                                        <Badge variant="secondary">{ticket.status}</Badge>
                                    </div>
                                    <p className="mt-3 text-xs text-muted-foreground">
                                        Last update: {new Date(ticket.updatedAt).toLocaleString("en-IN")}
                                    </p>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}


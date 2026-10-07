import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { cookies } from "next/headers";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import { Wrench } from "lucide-react";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { PORTAL_ACTIVE_ACCOUNT_COOKIE, resolvePortalAccountContext } from "@/shared/lib/auth/portalAccountContext";

export default async function PortalRepairsPage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    if (!session?.user || kind !== "customer") {
        redirect("/login?callbackUrl=/portal/repairs");
    }

    const customerId = parseInt((session.user as { customerId?: string }).customerId || "", 10);
    if (!Number.isFinite(customerId)) redirect("/login");

    const cookieStore = await cookies();
    const rawAccountId = cookieStore.get(PORTAL_ACTIVE_ACCOUNT_COOKIE)?.value;
    const preferredAccountId = rawAccountId ? Number(rawAccountId) : null;
    let context: Awaited<ReturnType<typeof resolvePortalAccountContext>>;
    try {
        context = await resolvePortalAccountContext(
            customerId,
            Number.isFinite(preferredAccountId) ? preferredAccountId : null
        );
    } catch {
        redirect("/portal");
    }

    // Phase 2 contract: enrich with repair timeline DTO + SLA details.
    const tickets = await prisma.ticket.findMany({
        where: { repair: { device: { accountId: context.active.accountId } } },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
            repair: { select: { device: { select: { type: true, brand: true, model: true } } } },
            ticketStatus: { select: { label: true } },
            // Customer-facing worker label takes precedence over the status name.
            ticketWorker: { select: { publicLabel: true } },
        },
    });

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
                                            <p className="text-xs text-muted-foreground">{ticket.repair?.device.brand} {ticket.repair?.device.model} · {ticket.repair?.device.type}</p>
                                        </div>
                                        <Badge variant="secondary">{ticket.ticketWorker?.publicLabel || ticket.ticketStatus.label}</Badge>
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


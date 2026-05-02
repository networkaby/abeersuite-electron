import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";

export default async function PortalTicketsPage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    if (!session?.user || kind !== "customer") {
        redirect("/portal/login?callbackUrl=/portal/tickets");
    }
    const customerId = parseInt((session.user as { customerId?: string }).customerId || "", 10);
    if (!Number.isFinite(customerId)) redirect("/portal/login");

    const tickets = await prisma.ticket.findMany({
        where: {
            device: {
                account: { customerId },
            },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
            device: { select: { type: true, brand: true, model: true } },
            ticketStatus: { select: { label: true } },
        },
    });

    return (
        <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
            <div className="flex items-center justify-between gap-4">
                <h1 className="text-2xl font-semibold">My tickets</h1>
                <Link href="/portal" className="text-sm text-primary underline">
                    Back
                </Link>
            </div>
            {tickets.length === 0 ? (
                <p className="text-muted-foreground">
                    No tickets found for devices linked to your customer account yet.
                </p>
            ) : (
                <ul className="space-y-3">
                    {tickets.map((t) => (
                        <li
                            key={t.id}
                            className="rounded-lg border border-border p-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <div>
                                <p className="font-medium">
                                    #{t.id} · {t.device.brand} {t.device.model}
                                </p>
                                <p className="text-sm text-muted-foreground">{t.device.type}</p>
                            </div>
                            <Badge variant="secondary">{t.ticketStatus.label}</Badge>
                        </li>
                    ))}
                </ul>
            )}
        </main>
    );
}

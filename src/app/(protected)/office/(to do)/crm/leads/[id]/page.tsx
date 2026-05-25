import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { getCrmPipeline } from "@/modules/customer/lib/crmPipeline";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import LeadEditForm, { type LeadEditInitial } from "./LeadEditForm";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export default async function CrmLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!permissions.includes(PERMISSIONS.ADMIN_BYPASS) && !permissions.includes(PERMISSIONS.CRM_VIEW)) {
        redirect("/office/core/assignments");
    }
    const canManage = permissions.includes(PERMISSIONS.ADMIN_BYPASS) || permissions.includes(PERMISSIONS.CRM_MANAGE);

    const id = Number((await params).id);
    if (!Number.isFinite(id) || id < 1) notFound();

    const pipeline = await getCrmPipeline(prisma);
    if (!pipeline) notFound();

    const lead = await prisma.crmLead.findFirst({
        where: { id, pipelineId: pipeline.id },
        include: {
            ticketStatus: { select: { id: true, label: true, color: true } },
            owner: { select: { id: true, name: true } },
            person: { select: { id: true, name: true, account: { select: { id: true } } } },
            company: { select: { id: true, name: true, account: { select: { id: true } } } },
            createdBy: { select: { id: true, name: true } },
        },
    });
    if (!lead) notFound();

    const users = await prisma.user.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 200,
    });

    const initial: LeadEditInitial = {
        id: lead.id,
        title: lead.title,
        contactName: lead.contactName,
        phone: lead.phone,
        email: lead.email,
        companyName: lead.companyName,
        valuePaise: lead.valuePaise,
        source: lead.source,
        notes: lead.notes,
        status: lead.status,
        ownerUserId: lead.ownerUserId,
        ticketStatus: lead.ticketStatus,
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/office/crm">Back</Link>
                    </Button>
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-2xl font-semibold tracking-tight">{lead.title}</h1>
                            <Badge className={lead.ticketStatus.color}>{lead.ticketStatus.label}</Badge>
                        </div>
                        <p className="text-muted-foreground text-sm mt-1">
                            {lead.valuePaise != null ? formatRupeesFromPaise(lead.valuePaise) : "No value set"}
                            {" · "}
                            Owner: {lead.owner?.name ?? "Unassigned"}
                            {" · "}
                            Created by {lead.createdBy.name}
                        </p>
                    </div>
                </div>
            </div>

            {(lead.person || lead.company) && (
                <div className="text-sm border-2 border-border bg-muted/30 p-3">
                    <span className="text-muted-foreground">Linked: </span>
                    {lead.person && (
                        lead.person.account ? (
                            <Link className="text-primary hover:underline" href={`/office/customers/${lead.person.account.id}`}>
                                {lead.person.name}
                            </Link>
                        ) : (
                            <span>{lead.person.name}</span>
                        )
                    )}
                    {lead.person && lead.company && " · "}
                    {lead.company && (
                        lead.company.account ? (
                            <Link className="text-primary hover:underline" href={`/office/customers/${lead.company.account.id}`}>
                                {lead.company.name}
                            </Link>
                        ) : (
                            <span>{lead.company.name}</span>
                        )
                    )}
                </div>
            )}

            <LeadEditForm
                lead={initial}
                statuses={pipeline.statuses.map((s) => ({ id: s.id, label: s.label }))}
                users={users}
                canManage={canManage}
            />
        </div>
    );
}

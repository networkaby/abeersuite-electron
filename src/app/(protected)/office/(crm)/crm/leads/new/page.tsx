import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { getCrmPipeline } from "@/modules/customer/lib/crmPipeline";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import LeadNewForm from "./LeadNewForm";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export default async function NewCrmLeadPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canManage = permissions.includes(PERMISSIONS.ADMIN_BYPASS) || permissions.includes(PERMISSIONS.CRM_MANAGE);
    if (!canManage) {
        redirect("/office/crm");
    }

    const pipeline = await getCrmPipeline(prisma);
    if (!pipeline?.statuses.length) {
        return (
            <div className="space-y-4">
                <Button variant="outline" asChild>
                    <Link href="/office/crm">Back</Link>
                </Button>
                <p className="text-muted-foreground text-sm">CRM pipeline is not configured.</p>
            </div>
        );
    }

    const entry = pipeline.statuses.find((s) => s.isEntryPoint) ?? pipeline.statuses[0];
    const users = await prisma.user.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 200,
    });

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" asChild>
                    <Link href="/office/crm">Back</Link>
                </Button>
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">New lead</h1>
                    <p className="text-muted-foreground text-sm">Create a lead on the CRM pipeline.</p>
                </div>
            </div>
            <LeadNewForm
                statuses={pipeline.statuses.map((s) => ({ id: s.id, label: s.label }))}
                users={users}
                defaultStatusId={entry.id}
            />
        </div>
    );
}

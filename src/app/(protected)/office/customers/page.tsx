import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { hasModuleNavAccess, hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import ContactsWorkspace from "@/modules/customer/components/ContactsWorkspace";

export default async function ContactsPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canView = hasModuleNavAccess(permissions, "customers");
    if (!canView) redirect("/office/work-flow-inbox");
    // Covers bypass + the CRUD ladder (customers:delete implies edit).
    const canEdit = hasPermissionWithScope(permissions, PERMISSIONS.CUSTOMERS_EDIT);

    const [positionRows, creditConfig] = await Promise.all([
        prisma.position.findMany({
            orderBy: { title: "asc" },
            select: { id: true, title: true, branch: { select: { name: true } } },
        }),
        // Fail-safe: a missing table (pre-`db push`) falls back to auto OFF.
        prisma.creditLimitConfig.findUnique({ where: { id: 1 }, select: { autoEnabled: true } }).catch(() => null),
    ]);
    const positions = positionRows.map((p) => ({ id: p.id, title: p.title, branchName: p.branch?.name ?? null }));

    return (
        <div className="h-full px-6 py-5">
            <ContactsWorkspace positions={positions} canEdit={canEdit} autoCredit={creditConfig?.autoEnabled ?? false} />
        </div>
    );
}

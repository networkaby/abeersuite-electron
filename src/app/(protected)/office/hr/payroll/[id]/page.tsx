import { auth } from "@/auth";
import { notFound } from "next/navigation";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import PayrollRunWorkspace from "@/modules/hr/components/PayrollRunWorkspace";

// /office/hr/payroll/[id] — one month's run, staff-wise.
export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const runId = Number((await params).id);
    if (!Number.isInteger(runId) || runId <= 0) notFound();

    const canRun = hasPermissionWithScope(permissions, PERMISSIONS.HR_PAYROLL_RUN);
    return <PayrollRunWorkspace runId={runId} canRun={canRun} />;
}

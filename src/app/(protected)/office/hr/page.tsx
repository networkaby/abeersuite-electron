import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";

// /office/hr — land on the first HR page this person is actually ticked for.
//
// HR is ticked page by page, so a fixed redirect to Staff Directory would bounce
// anyone who holds only, say, Leave straight back out of the module. Sidebar
// order, so the landing matches what they see on the left.
const LANDING: [key: string, href: string][] = [
    ["me", "/office/hr/me"],
    ["staff", "/office/hr/staff"],
    ["attendance", "/office/hr/attendance"],
    ["activity", "/office/hr/activity"],
    ["leave", "/office/hr/leave"],
    ["holidays", "/office/hr/holidays"],
    ["payRules", "/office/hr/pay-rules"],
    ["payroll", "/office/hr/payroll"],
];

export default async function HrIndexPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (permissions.includes(PERMISSIONS.ADMIN_BYPASS)) redirect("/office/hr/staff");
    const first = LANDING.find(([key]) => permissions.includes(sidebarChildPermissionId("hr", key)));
    redirect(first ? first[1] : "/office/work-flow-inbox");
}

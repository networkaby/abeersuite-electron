import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { PartyDirectory } from "@/modules/customer/components/PartyDirectory";

// Contacts — every party (persons and companies together), so a party can be
// found without knowing its type. The old people-only ContactsWorkspace list is
// parked for now; it is no longer mounted anywhere.
export default async function ContactsPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "customers")) redirect("/office/work-flow-inbox");

    return <PartyDirectory scope="all" />;
}

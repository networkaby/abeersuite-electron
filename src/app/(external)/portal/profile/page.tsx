import { redirect } from "next/navigation";
import { auth } from "@/auth";
import PortalProfileView from "@/modules/external/portal/profile/PortalProfileView";

export default async function PortalProfilePage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    if (!session?.user || kind !== "customer") {
        redirect("/login?callbackUrl=/portal/profile");
    }
    return <PortalProfileView />;
}

import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function PortalTicketsPage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    if (!session?.user || kind !== "customer") {
        redirect("/login?callbackUrl=/portal/tickets");
    }
    redirect("/portal/repairs");
}

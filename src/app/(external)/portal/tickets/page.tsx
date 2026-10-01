import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** Old address of My Repairs — kept only for customers' bookmarks; nothing in
 *  the app links here any more. */
export default async function PortalTicketsPage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    if (!session?.user || kind !== "customer") {
        redirect("/login?callbackUrl=/portal/tickets");
    }
    redirect("/portal/repairs");
}

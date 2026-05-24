import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound, redirect } from "next/navigation";

// /office/customers/[id] uses the account ID as the URL key (legacy pattern).
// We look up whether the account belongs to a Person or Company, then redirect
// into the EntityListPanel explorer at /office/customers/all so the customer
// opens dynamically in the right pane — no separate full-page view needed.
export default async function CustomerDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const accountId = Number(id);
    if (!Number.isFinite(accountId)) notFound();

    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { personId: true, companyId: true },
    });

    if (!account) notFound();

    // The Account row flips its personId↔companyId on conversion. Whichever
    // side is currently set is the live party; route the URL there.
    if (account.personId) {
        redirect(`/office/customers/all?personId=${account.personId}`);
    }
    if (account.companyId) {
        redirect(`/office/customers/all?companyId=${account.companyId}`);
    }
    notFound();
}

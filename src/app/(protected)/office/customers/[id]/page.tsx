import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import PersonProfileView from "@/modules/customer/components/PersonProfileView";
import CompanyProfileView from "@/modules/customer/components/CompanyProfileView";

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
        select: {
            personId: true,
            companyId: true,
            person: { select: { isActive: true } },
            company: { select: { isActive: true } },
        },
    });

    if (!account) notFound();

    if (account.personId && account.person?.isActive) {
        return <PersonProfileView personId={account.personId} backHref="/office/customers" />;
    }
    if (account.companyId && account.company?.isActive) {
        return <CompanyProfileView companyId={account.companyId} backHref="/office/customers" />;
    }
    notFound();
}

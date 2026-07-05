import { prisma } from "@/shared/lib/prisma/prismaClient";

async function main() {
    const [missingAccountLink, missingPersonForAccountLinked, missingPersonalAccounts] = await Promise.all([
        // Orders are order-flavour Tickets now: accountId on the core, personId on the detail.
        prisma.ticket.count({
            where: { order: { isNot: null }, accountId: null },
        }),
        prisma.ticket.count({
            where: {
                accountId: { not: null },
                order: { personId: null },
            },
        }),
        prisma.person.count({
            where: {
                account: null,
            },
        }),
    ]);

    const report = {
        missingAccountLink,
        missingPersonForAccountLinked,
        missingPersonalAccounts,
        passed:
            missingAccountLink === 0 &&
            missingPersonForAccountLinked === 0 &&
            missingPersonalAccounts === 0,
    };

    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) {
        process.exitCode = 1;
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });


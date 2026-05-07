import { prisma } from "@/lib/prisma";

async function main() {
    const [missingAccountLink, missingPersonForAccountLinked, missingPersonalAccounts] = await Promise.all([
        prisma.shopOrder.count({
            where: { accountId: null },
        }),
        prisma.shopOrder.count({
            where: {
                accountId: { not: null },
                personId: null,
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


import { prisma } from "@/lib/prisma";

async function main() {
    const [missingAccountLink, missingCustomerForAccountLinked, missingPersonalAccounts] = await Promise.all([
        prisma.shopOrder.count({
            where: { accountId: null },
        }),
        prisma.shopOrder.count({
            where: {
                accountId: { not: null },
                customerId: null,
            },
        }),
        prisma.customer.count({
            where: {
                account: null,
            },
        }),
    ]);

    const report = {
        missingAccountLink,
        missingCustomerForAccountLinked,
        missingPersonalAccounts,
        passed:
            missingAccountLink === 0 &&
            missingCustomerForAccountLinked === 0 &&
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


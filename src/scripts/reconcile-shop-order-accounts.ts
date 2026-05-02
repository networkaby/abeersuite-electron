import { prisma } from "@/lib/prisma";
import { normalizePortalEmail, normalizePortalPhone } from "@/lib/auth/portal-identifier";

type ReconcileResult = {
    scanned: number;
    updated: number;
    createdCustomers: number;
    createdAccounts: number;
    skipped: number;
};

async function ensureCustomerAccount(customerId: number, fallbackName: string, dryRun: boolean) {
    const existing = await prisma.account.findUnique({
        where: { customerId },
        select: { id: true },
    });
    if (existing) return { accountId: existing.id, created: false };

    if (dryRun) return { accountId: -1, created: true };
    const created = await prisma.account.create({
        data: { customerId, name: fallbackName || "Customer" },
        select: { id: true },
    });
    return { accountId: created.id, created: true };
}

async function run(dryRun: boolean): Promise<ReconcileResult> {
    const result: ReconcileResult = {
        scanned: 0,
        updated: 0,
        createdCustomers: 0,
        createdAccounts: 0,
        skipped: 0,
    };

    const orders = await prisma.shopOrder.findMany({
        where: { accountId: null },
        orderBy: { createdAt: "asc" },
        select: {
            id: true,
            customerId: true,
            guestEmail: true,
            guestPhone: true,
            createdAt: true,
        },
    });

    for (const order of orders) {
        result.scanned += 1;
        const guestEmailNorm = order.guestEmail ? normalizePortalEmail(order.guestEmail) : null;
        const guestPhoneNorm = order.guestPhone ? normalizePortalPhone(order.guestPhone) : null;

        let customerId = order.customerId;
        let customerName = "Customer";

        if (!customerId) {
            const credential = guestEmailNorm || guestPhoneNorm
                ? await prisma.customerPortalCredential.findFirst({
                      where: {
                          OR: [
                              ...(guestEmailNorm ? [{ emailNormalized: guestEmailNorm }] : []),
                              ...(guestPhoneNorm ? [{ phoneNormalized: guestPhoneNorm }] : []),
                          ],
                      },
                      include: { customer: { select: { id: true, name: true } } },
                  })
                : null;

            if (credential?.customer?.id) {
                customerId = credential.customer.id;
                customerName = credential.customer.name;
            } else if (guestEmailNorm || guestPhoneNorm) {
                if (dryRun) {
                    customerId = -1;
                    customerName = guestEmailNorm ? guestEmailNorm.split("@")[0] : "Customer";
                } else {
                    const createdCustomer = await prisma.customer.create({
                        data: {
                            name: guestEmailNorm ? guestEmailNorm.split("@")[0] : "Customer",
                            email: guestEmailNorm ?? undefined,
                            phone: guestPhoneNorm ? `+91${guestPhoneNorm}` : order.guestPhone ?? undefined,
                        },
                        select: { id: true, name: true },
                    });
                    customerId = createdCustomer.id;
                    customerName = createdCustomer.name;
                    result.createdCustomers += 1;
                }
            } else {
                result.skipped += 1;
                continue;
            }
        } else {
            const customer = await prisma.customer.findUnique({
                where: { id: customerId },
                select: { name: true },
            });
            customerName = customer?.name ?? "Customer";
        }

        const ensured = await ensureCustomerAccount(customerId, customerName, dryRun);
        if (ensured.created) result.createdAccounts += 1;

        if (!dryRun) {
            await prisma.shopOrder.update({
                where: { id: order.id },
                data: {
                    customerId,
                    accountId: ensured.accountId,
                },
            });
        }

        result.updated += 1;
    }

    return result;
}

async function main() {
    const dryRun = process.argv.includes("--dry-run");
    const summary = await run(dryRun);
    console.log(
        JSON.stringify(
            {
                mode: dryRun ? "dry-run" : "write",
                ...summary,
            },
            null,
            2
        )
    );
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });


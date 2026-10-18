import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { normalizePortalEmail, normalizePortalPhone } from "@/shared/lib/auth/portalIdentifier";

type ReconcileResult = {
    scanned: number;
    updated: number;
    createdPersons: number;
    createdAccounts: number;
    skipped: number;
};

async function ensurePersonAccount(personId: number, fallbackName: string, dryRun: boolean) {
    const existing = await prisma.account.findUnique({
        where: { personId },
        select: { id: true },
    });
    if (existing) return { accountId: existing.id, created: false };

    if (dryRun) return { accountId: -1, created: true };
    const group = await prisma.accountGroup.findFirst({ where: { name: ACCOUNT_GROUPS.SUNDRY_DEBTORS }, select: { id: true } });
    const created = await prisma.account.create({
        data: { personId, name: fallbackName || "Customer", groupId: group?.id ?? null },
        select: { id: true },
    });
    return { accountId: created.id, created: true };
}

async function run(dryRun: boolean): Promise<ReconcileResult> {
    const result: ReconcileResult = {
        scanned: 0,
        updated: 0,
        createdPersons: 0,
        createdAccounts: 0,
        skipped: 0,
    };

    // Orders are order-flavour Tickets: accountId on the core, identity on the detail.
    const orderTickets = await prisma.ticket.findMany({
        where: { order: { isNot: null }, accountId: null },
        orderBy: { createdAt: "asc" },
        select: {
            id: true,
            createdAt: true,
            order: { select: { personId: true, guestEmail: true, guestPhone: true } },
        },
    });
    const orders = orderTickets.map((t) => ({
        id: t.id,
        personId: t.order?.personId ?? null,
        guestEmail: t.order?.guestEmail ?? null,
        guestPhone: t.order?.guestPhone ?? null,
        createdAt: t.createdAt,
    }));

    for (const order of orders) {
        result.scanned += 1;
        const guestEmailNorm = order.guestEmail ? normalizePortalEmail(order.guestEmail) : null;
        const guestPhoneNorm = order.guestPhone ? normalizePortalPhone(order.guestPhone) : null;

        let personId = order.personId;
        let personName = "Customer";

        if (!personId) {
            const credential = guestEmailNorm || guestPhoneNorm
                ? await prisma.personPortalCredential.findFirst({
                      where: {
                          OR: [
                              ...(guestEmailNorm ? [{ emailNormalized: guestEmailNorm }] : []),
                              ...(guestPhoneNorm ? [{ phoneNormalized: guestPhoneNorm }] : []),
                          ],
                      },
                      include: { person: { select: { id: true, name: true } } },
                  })
                : null;

            if (credential?.person?.id) {
                personId = credential.person.id;
                personName = credential.person.name;
            } else if (guestEmailNorm || guestPhoneNorm) {
                if (dryRun) {
                    personId = -1;
                    personName = guestEmailNorm ? guestEmailNorm.split("@")[0] : "Customer";
                } else {
                    const created = await prisma.$transaction(async (tx) => {
                        const p = await tx.person.create({
                            data: {
                                name: guestEmailNorm ? guestEmailNorm.split("@")[0] : "Customer",
                            },
                            select: { id: true, name: true },
                        });
                        if (guestEmailNorm) {
                            await tx.email.create({
                                data: { email: guestEmailNorm, personId: p.id, isPrimary: true },
                            });
                        }
                        if (guestPhoneNorm || order.guestPhone) {
                            await tx.phone.create({
                                data: {
                                    phone: guestPhoneNorm ?? order.guestPhone!,
                                    personId: p.id,
                                    isPrimary: true,
                                },
                            });
                        }
                        return p;
                    });
                    personId = created.id;
                    personName = created.name;
                    result.createdPersons += 1;
                }
            } else {
                result.skipped += 1;
                continue;
            }
        } else {
            const person = await prisma.person.findUnique({
                where: { id: personId },
                select: { name: true },
            });
            personName = person?.name ?? "Customer";
        }

        const ensured = await ensurePersonAccount(personId, personName, dryRun);
        if (ensured.created) result.createdAccounts += 1;

        if (!dryRun) {
            await prisma.ticket.update({
                where: { id: order.id },
                data: {
                    accountId: ensured.accountId,
                    order: { update: { personId } },
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

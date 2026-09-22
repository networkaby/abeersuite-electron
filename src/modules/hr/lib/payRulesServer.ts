import "server-only";

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { parsePayRules, type PayRules } from "@/shared/lib/hr/payRules";

/**
 * The shop's pay rules, server side.
 *
 * One tiny read of the OrgDefaults singleton, always through `parsePayRules`, so
 * a row saved before a rule existed answers with the code default rather than
 * putting `undefined` into an arithmetic that ends on somebody's payslip.
 */
export async function loadPayRules(): Promise<PayRules> {
    const row = await prisma.orgDefaults.findUnique({
        where: { id: 1 },
        select: { hrPayRulesJson: true },
    });
    return parsePayRules(row?.hrPayRulesJson);
}

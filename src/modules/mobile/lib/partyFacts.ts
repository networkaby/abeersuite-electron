import type { Party } from "@/shared/lib/parties/partyCatalog";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

/** What tells two parties of the same name apart — read from the on-device party
 *  catalogue, so it costs no server read. `group` is left out for customers (the
 *  usual case); `callable` only for suppliers (owner, 2026-10-03: customers' numbers
 *  show but are not dialled from the phone app for now). */
export function partyFacts(p: Party) {
    return {
        address: p.address?.trim() || null,
        phones: p.phones,
        companies: p.linkedCompanies.map((c) => c.name),
        group: p.accountGroup === ACCOUNT_GROUPS.SUNDRY_DEBTORS ? null : p.accountGroup,
        callable: p.accountGroup === ACCOUNT_GROUPS.SUNDRY_CREDITORS,
    };
}

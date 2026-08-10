"use client";

import type { ComponentProps } from "react";
import CompanyProfileEdit from "./CompanyProfileEdit";
import AccountCreditLimitCard from "./AccountCreditLimitCard";
import AccountOpeningBalanceCard from "./AccountOpeningBalanceCard";
import AccountClassificationCard from "./AccountClassificationCard";
import CustomerGroupCard from "./CustomerGroupCard";
import DevicesMiniGrid from "./DevicesMiniGrid";
import DeletePartyCard from "./DeletePartyCard";

type ProfileData = ComponentProps<typeof CompanyProfileEdit>["profile"];

// Shared Profile-tab body for a Company. Used by both the Companies page
// (customers/companies) and the combined All-customers page (customers/all) so
// the two can never drift — one place owns profile edit + credit limit +
// account group / convert + devices.
interface Props {
    detail: {
        id: number;
        accountId: number;
        creditLimit: string | null;
        accountGroupName?: string | null;
        customerGroupId?: number | null;
        openingBalance?: string | number | null;
        openingBalanceType?: "DEBIT" | "CREDIT" | null;
        openingBalanceDate?: string | null;
        isActive?: boolean;
        name: string;
        address: string | null;
        aliases?: string[];
        companyReg: string | null;
        taxId: string | null;
        contactRows: { phones: ProfileData["phones"]; emails: ProfileData["emails"] } | null;
        devices: ComponentProps<typeof DevicesMiniGrid>["devices"];
    };
    canEditCompany: boolean;
    canDeleteCompany: boolean;
    onSaved: () => void;
    /** Navigate to the new person after a Company → Person conversion. */
    onConverted: (personId: number) => void;
    /** The company was deleted or deactivated — close the detail view. */
    onDeleted: (outcome: "deleted" | "deactivated") => void;
    /** The company was reactivated — refetch the detail. */
    onReactivated: () => void;
}

export default function CompanyProfileTab({
    detail, canEditCompany, canDeleteCompany, onSaved, onConverted, onDeleted, onReactivated,
}: Props) {
    return (
        <div className="space-y-6">
            <CompanyProfileEdit
                key={detail.id}
                profile={{
                    id: detail.id,
                    accountId: detail.accountId,
                    name: detail.name,
                    address: detail.address,
                    aliases: detail.aliases ?? [],
                    companyReg: detail.companyReg,
                    taxId: detail.taxId,
                    phones: detail.contactRows?.phones ?? [],
                    emails: detail.contactRows?.emails ?? [],
                }}
                onSaved={onSaved}
            />
            {/* Credit limit + account group + convert are edit-class actions.
                Keep both cards visible to everyone, but disable them (grey,
                non-interactive) for anyone without Contacts edit rights —
                better than hiding so the classification stays readable. */}
            <fieldset
                disabled={!canEditCompany}
                className={`min-w-0 space-y-6 border-0 p-0 ${canEditCompany ? "" : "opacity-60"}`}
            >
                <AccountCreditLimitCard
                    key={`cl-${detail.id}`}
                    accountId={detail.accountId}
                    initialLimit={detail.creditLimit}
                    canEdit
                    onSaved={onSaved}
                />
                <AccountOpeningBalanceCard
                    key={`ob-${detail.id}`}
                    accountId={detail.accountId}
                    initialAmount={detail.openingBalance ?? null}
                    initialType={detail.openingBalanceType ?? null}
                    canEdit
                    onSaved={onSaved}
                />
                <AccountClassificationCard
                    key={`grp-${detail.id}`}
                    accountId={detail.accountId}
                    party={{ type: "company", id: detail.id, name: detail.name }}
                    groupName={detail.accountGroupName ?? null}
                    canEdit
                    onSaved={onSaved}
                    onConverted={onConverted}
                />
                <CustomerGroupCard
                    key={`cg-${detail.id}`}
                    party={{ kind: "company", id: detail.id }}
                    initialGroupId={detail.customerGroupId ?? null}
                    onSaved={onSaved}
                />
            </fieldset>
            <DevicesMiniGrid devices={detail.devices} />
            <DeletePartyCard
                party={{ type: "company", id: detail.id, name: detail.name }}
                isActive={detail.isActive ?? true}
                canDelete={canDeleteCompany}
                onDeleted={onDeleted}
                onReactivated={onReactivated}
            />
        </div>
    );
}

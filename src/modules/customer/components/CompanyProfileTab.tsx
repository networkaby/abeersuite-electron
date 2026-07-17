"use client";

import type { ComponentProps } from "react";
import CompanyProfileEdit from "./CompanyProfileEdit";
import AccountCreditLimitCard from "./AccountCreditLimitCard";
import DevicesMiniGrid from "./DevicesMiniGrid";

type ProfileData = ComponentProps<typeof CompanyProfileEdit>["profile"];

// Shared Profile-tab body for a Company. Used by both the Companies page
// (customers/companies) and the combined All-customers page (customers/all) so
// the two can never drift — one place owns profile edit + credit limit + devices.
interface Props {
    detail: {
        id: number;
        accountId: number;
        creditLimit: string | null;
        name: string;
        address: string | null;
        companyReg: string | null;
        taxId: string | null;
        contactRows: { phones: ProfileData["phones"]; emails: ProfileData["emails"] } | null;
        devices: ComponentProps<typeof DevicesMiniGrid>["devices"];
    };
    canEditCompany: boolean;
    onSaved: () => void;
}

export default function CompanyProfileTab({ detail, canEditCompany, onSaved }: Props) {
    return (
        <div className="space-y-6">
            <CompanyProfileEdit
                key={detail.id}
                profile={{
                    id: detail.id,
                    name: detail.name,
                    address: detail.address,
                    companyReg: detail.companyReg,
                    taxId: detail.taxId,
                    phones: detail.contactRows?.phones ?? [],
                    emails: detail.contactRows?.emails ?? [],
                }}
                onSaved={onSaved}
            />
            <AccountCreditLimitCard
                key={`cl-${detail.id}`}
                accountId={detail.accountId}
                initialLimit={detail.creditLimit}
                canEdit={canEditCompany}
                onSaved={onSaved}
            />
            <DevicesMiniGrid devices={detail.devices} />
        </div>
    );
}

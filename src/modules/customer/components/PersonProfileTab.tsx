"use client";

import type { ComponentProps } from "react";
import PersonProfileEdit from "./PersonProfileEdit";
import AccountCreditLimitCard from "./AccountCreditLimitCard";
import AccountClassificationCard from "./AccountClassificationCard";
import DevicesMiniGrid from "./DevicesMiniGrid";
import CustomerEmergencyPasswordResetCard from "./CustomerEmergencyPasswordResetCard";

type ProfileData = ComponentProps<typeof PersonProfileEdit>["profile"];

// Shared Profile-tab body for a Person. Used by both the People page
// (customers/person) and the combined All-customers page (customers/all) so the
// two can never drift — one place owns profile edit + credit limit + devices +
// emergency reset. `detail` is structurally typed to the fields it needs, so
// either page's detail object satisfies it.
interface Props {
    detail: {
        id: number;
        accountId: number;
        creditLimit: string | null;
        accountGroupName?: string | null;
        name: string;
        address: string | null;
        phones: ProfileData["phones"];
        emails: ProfileData["emails"];
        devices: ComponentProps<typeof DevicesMiniGrid>["devices"];
    };
    canEditCustomer: boolean;
    canManageUsers: boolean;
    onSaved: () => void;
    /** Navigate to the new company after a Person → Company conversion. */
    onConverted: (companyId: number) => void;
}

export default function PersonProfileTab({ detail, canEditCustomer, canManageUsers, onSaved, onConverted }: Props) {
    return (
        <div className="space-y-6">
            <PersonProfileEdit
                key={detail.id}
                profile={{
                    id: detail.id,
                    name: detail.name,
                    address: detail.address,
                    phones: detail.phones ?? [],
                    emails: detail.emails ?? [],
                }}
                onSaved={onSaved}
            />
            <AccountCreditLimitCard
                key={`cl-${detail.id}`}
                accountId={detail.accountId}
                initialLimit={detail.creditLimit}
                canEdit={canEditCustomer}
                onSaved={onSaved}
            />
            <AccountClassificationCard
                key={`grp-${detail.id}`}
                accountId={detail.accountId}
                personId={detail.id}
                personName={detail.name}
                groupName={detail.accountGroupName ?? null}
                canEdit={canEditCustomer}
                onSaved={onSaved}
                onConverted={onConverted}
            />
            <DevicesMiniGrid devices={detail.devices} />
            {canManageUsers && <CustomerEmergencyPasswordResetCard customerId={detail.id} />}
        </div>
    );
}

"use client";

import type { ComponentProps } from "react";
import PersonProfileEdit from "./PersonProfileEdit";
import AccountCreditLimitCard from "./AccountCreditLimitCard";
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
        name: string;
        address: string | null;
        phones: ProfileData["phones"];
        emails: ProfileData["emails"];
        devices: ComponentProps<typeof DevicesMiniGrid>["devices"];
    };
    canEditCustomer: boolean;
    canManageUsers: boolean;
    onSaved: () => void;
}

export default function PersonProfileTab({ detail, canEditCustomer, canManageUsers, onSaved }: Props) {
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
            <DevicesMiniGrid devices={detail.devices} />
            {canManageUsers && <CustomerEmergencyPasswordResetCard customerId={detail.id} />}
        </div>
    );
}

"use client";

import type { ComponentProps } from "react";
import PersonProfileEdit from "./PersonProfileEdit";
import AccountCreditLimitCard from "./AccountCreditLimitCard";
import AccountOpeningBalanceCard from "./AccountOpeningBalanceCard";
import AccountClassificationCard from "./AccountClassificationCard";
import CustomerGroupCard from "./CustomerGroupCard";
import DevicesMiniGrid from "./DevicesMiniGrid";
import CustomerEmergencyPasswordResetCard from "./CustomerEmergencyPasswordResetCard";
import DeletePartyCard from "./DeletePartyCard";

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
        customerGroupId?: number | null;
        openingBalance?: string | number | null;
        openingBalanceType?: "DEBIT" | "CREDIT" | null;
        openingBalanceDate?: string | null;
        isActive?: boolean;
        name: string;
        address: string | null;
        aliases?: string[];
        phones: ProfileData["phones"];
        emails: ProfileData["emails"];
        devices: ComponentProps<typeof DevicesMiniGrid>["devices"];
    };
    canEditCustomer: boolean;
    canManageUsers: boolean;
    canDeleteCustomer: boolean;
    onSaved: () => void;
    /** Navigate to the new company after a Person → Company conversion. */
    onConverted: (companyId: number) => void;
    /** The person was deleted or deactivated — close the detail view. */
    onDeleted: (outcome: "deleted" | "deactivated") => void;
    /** The person was reactivated — refetch the detail. */
    onReactivated: () => void;
}

export default function PersonProfileTab({
    detail, canEditCustomer, canManageUsers, canDeleteCustomer, onSaved, onConverted, onDeleted, onReactivated,
}: Props) {
    // The edit-class cards are split across two <fieldset>s (opening balance sits
    // between them on its own gate), so the grey-out props live here rather than
    // being written twice.
    const editGate = {
        disabled: !canEditCustomer,
        className: `min-w-0 space-y-6 border-0 p-0 ${canEditCustomer ? "" : "opacity-60"}`,
    };

    return (
        <div className="space-y-6">
            <PersonProfileEdit
                key={detail.id}
                profile={{
                    id: detail.id,
                    accountId: detail.accountId,
                    name: detail.name,
                    address: detail.address,
                    aliases: detail.aliases ?? [],
                    phones: detail.phones ?? [],
                    emails: detail.emails ?? [],
                }}
                onSaved={onSaved}
            />
            {/* Credit limit + account group + convert are edit-class actions.
                Keep the cards visible to everyone, but disable them (grey,
                non-interactive) for anyone without Contacts edit rights —
                better than hiding so the classification stays readable. */}
            <fieldset {...editGate}>
                <AccountCreditLimitCard
                    key={`cl-${detail.id}`}
                    accountId={detail.accountId}
                    initialLimit={detail.creditLimit}
                    canEdit
                    onSaved={onSaved}
                />
            </fieldset>
            {/* Opening balance sits a rung HIGHER — with Delete, not Edit. Rewriting
                what a party owed before the books started moves real money the same
                way removing the party does, so whoever may delete a person may set it
                and nobody else. Same treatment as above: greyed, never hidden, so the
                figure stays readable to anyone who can open the profile. */}
            <fieldset
                disabled={!canDeleteCustomer}
                className={`min-w-0 space-y-6 border-0 p-0 ${canDeleteCustomer ? "" : "opacity-60"}`}
            >
                <AccountOpeningBalanceCard
                    key={`ob-${detail.id}`}
                    accountId={detail.accountId}
                    initialAmount={detail.openingBalance ?? null}
                    initialType={detail.openingBalanceType ?? null}
                    canEdit={canDeleteCustomer}
                    onSaved={onSaved}
                />
            </fieldset>
            <fieldset {...editGate}>
                <AccountClassificationCard
                    key={`grp-${detail.id}`}
                    accountId={detail.accountId}
                    party={{ type: "person", id: detail.id, name: detail.name }}
                    groupName={detail.accountGroupName ?? null}
                    canEdit
                    onSaved={onSaved}
                    onConverted={onConverted}
                />
                <CustomerGroupCard
                    key={`cg-${detail.id}`}
                    party={{ kind: "person", id: detail.id }}
                    initialGroupId={detail.customerGroupId ?? null}
                    onSaved={onSaved}
                />
            </fieldset>
            <DevicesMiniGrid devices={detail.devices} />
            {canManageUsers && <CustomerEmergencyPasswordResetCard customerId={detail.id} />}
            <DeletePartyCard
                party={{ type: "person", id: detail.id, name: detail.name }}
                isActive={detail.isActive ?? true}
                canDelete={canDeleteCustomer}
                onDeleted={onDeleted}
                onReactivated={onReactivated}
            />
        </div>
    );
}

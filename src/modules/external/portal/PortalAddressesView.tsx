"use client";

import { MapPin } from "lucide-react";
import AddressBook from "@/shared/components/address/AddressBook";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";

/**
 * Addresses — the customer's own address book. The first one may have come
 * from the shop counter; they can edit it, add more, and pick any at checkout.
 * `bare`: inside the customer app, which draws its own header.
 */
export default function PortalAddressesView({ bare = false }: { bare?: boolean }) {
    return (
        <main className={bare ? "px-3 py-3" : "px-4 py-6 md:px-6 md:py-8"}>
            <div className="mx-auto max-w-3xl space-y-5">
                {!bare && <PortalSectionHeader icon={MapPin} title="Addresses" description="Where we deliver. Pick any of these at checkout." />}
                <AddressBook apiBase="/api/portal/addresses" showRecipient emptyText="No address yet — add one, or add it at checkout." />
            </div>
        </main>
    );
}

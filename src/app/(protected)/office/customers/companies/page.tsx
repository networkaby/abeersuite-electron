import { PartyDirectory } from "@/modules/customer/components/PartyDirectory";

// Contacts filtered to companies — the same screen as All (see PartyDirectory).
export default function CompaniesPage() {
    return <PartyDirectory scope="company" />;
}

import { PartyDirectory } from "@/modules/customer/components/PartyDirectory";

// Contacts filtered to persons — the same screen as All (see PartyDirectory).
export default function PersonsPage() {
    return <PartyDirectory scope="person" />;
}

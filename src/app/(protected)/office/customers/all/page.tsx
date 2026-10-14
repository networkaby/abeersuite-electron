import { PartyDirectory } from "@/modules/customer/components/PartyDirectory";

// Contacts — persons and companies together. Person and Companies are the same
// screen, filtered (see PartyDirectory).
export default function AllContactsPage() {
    return <PartyDirectory scope="all" />;
}

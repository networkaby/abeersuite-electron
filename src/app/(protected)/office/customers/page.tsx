import { redirect } from "next/navigation";

// Contacts lives at /all (persons and companies together). The old people-only
// ContactsWorkspace list is parked; old links to /office/customers land on /all.
export default function ContactsPage() {
    redirect("/office/customers/all");
}

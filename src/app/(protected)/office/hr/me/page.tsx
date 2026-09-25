import { redirect } from "next/navigation";

// /office/hr/me — "My Info" grew into the Employee Portal at /office/me
// (owner, 2026-09-26). The sidebar tick `ui:sidebar:hr:me` still lands here so
// no grant was lost; the page itself is now the portal.
export default function Page() {
    redirect("/office/me");
}

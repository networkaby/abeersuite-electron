import { redirect } from "next/navigation";

/** Old address — the page is now My Profile. */
export default function PortalSettingsPage() {
    redirect("/portal/profile");
}

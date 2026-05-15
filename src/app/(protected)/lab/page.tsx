import { redirect } from "next/navigation";

/**
 * /lab landing → always lands the user on Front Office by default.
 * Back Office is reachable via the toggle in LabTopBar.
 */
export default function LabIndex() {
    redirect("/lab/front");
}

import { redirect } from "next/navigation";

// /office/hr — the module has one surface so far; land on it.
export default function HrIndexPage() {
    redirect("/office/hr/staff");
}

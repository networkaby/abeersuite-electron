import { redirect } from "next/navigation";

export default function WorkflowIndex() {
    redirect("/office/settings/workflow/statuses");
}

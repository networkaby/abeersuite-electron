import type { Metadata } from "next";
import LegalDocPage from "@/modules/external/legal/LegalDocPage";
import { DELETE_ACCOUNT } from "@/shared/lib/legal/legalContent";

export const metadata: Metadata = {
    title: DELETE_ACCOUNT.title,
    description: DELETE_ACCOUNT.summary,
    alternates: { canonical: "/delete-account" },
};

export default function DeleteAccountPage() {
    return <LegalDocPage doc={DELETE_ACCOUNT} />;
}

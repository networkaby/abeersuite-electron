import type { Metadata } from "next";
import LegalDocPage from "@/modules/external/legal/LegalDocPage";
import { PRIVACY_POLICY } from "@/shared/lib/legal/legalContent";

export const metadata: Metadata = {
    title: PRIVACY_POLICY.title,
    description: PRIVACY_POLICY.summary,
    alternates: { canonical: "/privacy" },
};

export default function PrivacyPolicyPage() {
    return <LegalDocPage doc={PRIVACY_POLICY} />;
}

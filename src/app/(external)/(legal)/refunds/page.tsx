import type { Metadata } from "next";
import LegalDocPage from "@/modules/external/legal/LegalDocPage";
import { REFUND_POLICY } from "@/shared/lib/legal/legalContent";

export const metadata: Metadata = {
    title: REFUND_POLICY.title,
    description: REFUND_POLICY.summary,
    alternates: { canonical: "/refunds" },
};

export default function RefundPolicyPage() {
    return <LegalDocPage doc={REFUND_POLICY} />;
}

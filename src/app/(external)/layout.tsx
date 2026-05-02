import type { Metadata } from "next";
import ExternalRootShell from "@/modules/external/ExternalRootShell";

export const metadata: Metadata = {
    title: "Customer · ServiceMgmt",
    description: "Customer portal and shop",
};

export default function ExternalLayout({ children }: { children: React.ReactNode }) {
    return <ExternalRootShell>{children}</ExternalRootShell>;
}

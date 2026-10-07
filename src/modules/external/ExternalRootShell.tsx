"use client";

import { Suspense } from "react";
import { SessionProvider } from "next-auth/react";
import WelcomeChoiceModal from "@/modules/external/portal/WelcomeChoiceModal";
import { Toaster } from "@/components/ui/sonner";
import ServiceWorkerRegister from "@/modules/external/pwa/ServiceWorkerRegister";

export default function ExternalRootShell({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            {children}
            <Suspense fallback={null}>
                <WelcomeChoiceModal />
            </Suspense>
            <ServiceWorkerRegister />
            {/* bottom-center — top-center collides with the sticky shop/portal
                header (backdrop-blur bleeds through the toast on overlap). */}
            <Toaster position="bottom-center" richColors closeButton />
        </SessionProvider>
    );
}

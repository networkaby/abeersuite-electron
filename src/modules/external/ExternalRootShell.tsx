"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "@/components/ui/sonner";
import ServiceWorkerRegister from "@/modules/external/pwa/ServiceWorkerRegister";

export default function ExternalRootShell({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            {children}
            <ServiceWorkerRegister />
            {/* bottom-center — top-center collides with the sticky shop/portal
                header (backdrop-blur bleeds through the toast on overlap). */}
            <Toaster position="bottom-center" richColors closeButton />
        </SessionProvider>
    );
}

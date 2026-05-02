"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "@/components/ui/sonner";

export default function ExternalRootShell({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            {children}
            <Toaster position="top-center" richColors closeButton />
        </SessionProvider>
    );
}

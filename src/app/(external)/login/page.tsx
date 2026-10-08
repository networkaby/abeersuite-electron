import { Suspense } from "react";
import CustomerLoginForm from "@/modules/external/portal/CustomerLoginForm";

export default function CustomerLoginPage() {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-dvh items-center justify-center px-4 py-10 text-sm text-muted-foreground">
                    Loading…
                </div>
            }
        >
            <CustomerLoginForm />
        </Suspense>
    );
}

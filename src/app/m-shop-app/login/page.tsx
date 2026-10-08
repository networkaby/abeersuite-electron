import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import ShopBrandMark from "@/modules/external/shop/ShopBrandMark";
import CustomerLoginForm from "@/modules/external/portal/CustomerLoginForm";
import { APP } from "@/modules/external/shopApp/appPaths";

/** The app's sign-in screen — the website's own sign-in form (OTP, password, onboarding), app-styled. */
export default async function CustomerAppLoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
    const { callbackUrl } = await searchParams;
    const back = callbackUrl?.startsWith(`${APP}`) ? callbackUrl : `${APP}/account`;
    const session = await auth();
    if ((session?.user as { kind?: string } | undefined)?.kind === "customer") redirect(back);
    return (
        <>
            <MobileHeader title="Sign in" back={APP} />
            <div className="flex justify-center pt-6">
                <ShopBrandMark className="h-10 w-36" />
            </div>
            <Suspense fallback={null}>
                <CustomerLoginForm app />
            </Suspense>
        </>
    );
}

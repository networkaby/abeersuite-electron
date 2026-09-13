import type { Metadata } from "next";
import NotFoundActions from "@/shared/components/NotFoundActions";
import { HAS_OFFICE_ROUTES } from "@/shared/lib/appMode";

export const metadata: Metadata = {
    title: "Page not found",
    robots: { index: false, follow: false },
};

/**
 * The app's own 404, replacing Next's bare built-in one (which offers no way out —
 * a dead end inside the desktop window, where there is no address bar to retype).
 *
 * The fallback destination follows the build variant rather than being hardcoded:
 * a staff build (full / office / counter) lands on the office home, the public
 * storefront build lands on the shop home. See `appMode.ts` for the variants.
 */
export default function NotFound() {
    const homeHref = HAS_OFFICE_ROUTES ? "/office" : "/";

    return (
        <main className="flex flex-1 items-center justify-center px-6 py-16">
            <div className="w-full max-w-md text-center">
                <p className="font-mono text-6xl font-bold tracking-tight text-muted-foreground">404</p>
                <h1 className="mt-4 text-2xl font-semibold">This page does not exist</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    The link may be old, or the address may have a typo. Nothing is broken —
                    just go back to where you were.
                </p>
                <div className="mt-8">
                    <NotFoundActions homeHref={homeHref} />
                </div>
            </div>
        </main>
    );
}

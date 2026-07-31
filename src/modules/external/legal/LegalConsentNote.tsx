import Link from "next/link";

/**
 * "By continuing you agree to…" line shown under the sign-in and registration
 * forms. Google's OAuth verification reviewers look for exactly this, and it is
 * the point where the customer actually gives consent under the DPDP Act.
 *
 * Not a checkbox — continuing is the consent act. If we ever need recorded
 * consent, `Person.agreedToTerms` / `agreedAt` already exist in the schema but
 * are not written by the portal sign-up path.
 */
export default function LegalConsentNote({ action = "continuing" }: { action?: string }) {
    return (
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
            By {action}, you agree to our{" "}
            <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
                Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
                Privacy Policy
            </Link>
            .
        </p>
    );
}

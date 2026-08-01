import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

/**
 * Which half of the app this deployment is serving.
 *
 * One branch, two Vercel projects:
 *   office = internal build (staff). Everything. Hidden from search engines.
 *   public = external build (shop + customer portal). Indexed.
 *
 * This is the only module that reads APP_MODE. Everything else imports from
 * here, so the mode cannot be interpreted two different ways in two places.
 *
 * Local dev keeps the full app, so anything other than an explicit "public"
 * means office — matching the note in .env.local.
 */
export const APP_MODE: "office" | "public" =
    process.env.APP_MODE === "public" ? "public" : "office";

export const IS_OFFICE = APP_MODE === "office";
export const IS_PUBLIC = APP_MODE === "public";

/**
 * The hostname this deployment answers to — the base for canonical URLs,
 * Open Graph URLs and the sitemap.
 *
 * Derived from the mode and the company constants rather than read from the
 * environment, because a deployment already knows which half it is and should
 * not have to be told its own address. We previously trusted
 * `NEXT_PUBLIC_SITE_URL ?? NEXTAUTH_URL`, and a stray localhost value copied
 * into Vercel made production publish `http://localhost:3000/...` canonicals —
 * every public page quietly telling Google its original lived at an address
 * nobody can reach.
 *
 * NEXT_PUBLIC_SITE_URL still wins OUTSIDE production, so `pnpm dev` renders
 * localhost canonicals instead of production ones. In production it is ignored
 * entirely, which is the point: no environment mistake can move the canonical
 * host again.
 */
export const CANONICAL_SITE_URL: string =
    process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_SITE_URL
        ? process.env.NEXT_PUBLIC_SITE_URL
        : IS_OFFICE
          ? COMPANY_DETAILS.sites.office
          : COMPANY_DETAILS.sites.shop;

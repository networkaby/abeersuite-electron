import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { parseAppMode, modeFlags, type AppMode } from "@/shared/lib/appModeCore";

/**
 * Which variant of the app this deployment is serving.
 *
 * One branch, four possible builds:
 *   full    = internal build (staff). Everything. Hidden from search engines.
 *   public  = external build (shop + customer portal). Indexed.
 *   office  = desktop build for admin/management — everything minus public routes.
 *   counter = desktop build for shop-floor tills — POS only, minimal.
 *
 * This is the only module in `src/` that reads APP_MODE. Everything else imports
 * from here, so the mode cannot be interpreted two different ways in two places.
 * The parsing and per-mode facts themselves live in `appModeCore.ts` (dependency-free,
 * so `next.config.ts` and the build scripts can read the same contract without pulling
 * in `COMPANY_DETAILS`).
 *
 * Local dev keeps the full app, so anything other than an explicit mode name means
 * full — matching the note in .env. An unrecognised value THROWS rather than silently
 * becoming full; see `parseAppMode`.
 */
export const APP_MODE: AppMode = parseAppMode(process.env.APP_MODE);

const FLAGS = modeFlags(APP_MODE);

export const HAS_OFFICE_ROUTES = FLAGS.hasOfficeRoutes;
export const HAS_PUBLIC_ROUTES = FLAGS.hasPublicRoutes;
export const IS_COUNTER = FLAGS.isCounter;
export const INDEXABLE = FLAGS.indexable;

/** Derived aliases kept for the existing "full vs public" call sites. Prefer the
 *  intent-named flags above in new code — `IS_FULL` mis-handles `office` and `counter`. */
export const IS_FULL = APP_MODE === "full";
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
        // "public" is the only mode whose primary content is the storefront — full,
        // office and counter are all staff-facing, even though "full" also happens to
        // contain the public routes (nothing strips them out of a full build).
        : APP_MODE === "public"
          ? COMPANY_DETAILS.sites.shop
          : COMPANY_DETAILS.sites.office;

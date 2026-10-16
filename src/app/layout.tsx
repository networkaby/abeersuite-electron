import type { Metadata, Viewport } from "next";
import { DM_Sans, Space_Mono, Roboto_Condensed } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import CounterSetupGuard from "@/shared/components/CounterSetupGuard";
import CounterReconciler from "@/shared/components/CounterReconciler";
import GlAccountsWarmup from "@/shared/components/GlAccountsWarmup";
import PartiesWarmup from "@/shared/components/PartiesWarmup";
import StatusTitleUpdater from "@/shared/components/StatusTitleUpdater";
import ReplicaReadyGate from "@/shared/components/ReplicaReadyGate";
import UpdatePrompt from "@/shared/components/UpdatePrompt";
import ConfirmHost from "@/shared/components/ConfirmHost";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { CANONICAL_SITE_URL, INDEXABLE } from "@/shared/lib/appMode";

const fontSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });
const fontMono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-mono" });
const robotoCondensed = Roboto_Condensed({ subsets: ["latin"], variable: "--font-roboto-condensed", });
// Derived from APP_MODE, not from the environment — see lib/appMode.ts for why.
const SITE_URL = CANONICAL_SITE_URL;

const DEFAULT_TITLE = `${COMPANY_DETAILS.brandName} · ${COMPANY_DETAILS.tagline}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: `%s · ${COMPANY_DETAILS.brandName}`,
  },
  description: COMPANY_DETAILS.description,
  applicationName: COMPANY_DETAILS.brandName,
  keywords: COMPANY_DETAILS.keywords,
  // The internal build must never invite indexing — robots.txt already says
  // "don't crawl", and a page saying "index me" in the same breath contradicts
  // it. Belt and braces with the X-Robots-Tag header in next.config.ts, which
  // also covers the sign-in redirects that carry no HTML at all.
  robots: INDEXABLE ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: COMPANY_DETAILS.brandName,
    title: DEFAULT_TITLE,
    description: COMPANY_DETAILS.description,
    url: "/",
    locale: COMPANY_DETAILS.locale,
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: COMPANY_DETAILS.description,
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: COMPANY_DETAILS.themeColor.light },
    { media: "(prefers-color-scheme: dark)", color: COMPANY_DETAILS.themeColor.dark },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      // className={`${fontSans.variable} ${fontMono.variable} h-full antialiased`}
      className={`${fontSans.variable} ${fontMono.variable} ${robotoCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <CounterReconciler />
        <GlAccountsWarmup />
        <PartiesWarmup />
        <StatusTitleUpdater />
        <ReplicaReadyGate />
        <UpdatePrompt />
        {/* One dialog for every confirmAction() in the app — see confirmStore.ts. */}
        <ConfirmHost />
        <ThemeProvider>
          <CounterSetupGuard>{children}</CounterSetupGuard>
        </ThemeProvider>
      </body>
    </html>
  );
}

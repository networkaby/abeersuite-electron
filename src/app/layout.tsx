import type { Metadata, Viewport } from "next";
import { DM_Sans, Space_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

const fontSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });
const fontMono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-mono" });

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXTAUTH_URL ?? COMPANY_DETAILS.siteUrl;

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
  robots: { index: true, follow: true },
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
      className={`${fontSans.variable} ${fontMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}

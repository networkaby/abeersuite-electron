import type { Metadata } from "next";
import "./globals.css";

// System-font fallbacks — Geist will be loaded by the browser from the CDN
// defined in globals.css if available, otherwise system sans/mono are used.
const geistSans = { variable: "--font-geist-sans", className: "" };
const geistMono = { variable: "--font-geist-mono", className: "" };

export const metadata: Metadata = {
  title: "ServiceMgmt · Network Service",
  description: "Service ticket and repair management system for tracking customers, devices, and technicians.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

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
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}

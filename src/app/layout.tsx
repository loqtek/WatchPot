import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthGateScript } from "@/components/auth/auth-gate-script";
import { ToastProvider } from "@/components/providers/toast-provider";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "watchPot",
    template: "%s · watchPot",
  },
  description: "Honeypot control plane",
  icons: {
    icon: [{ url: "/watchPotLogoNoBg.png", type: "image/png" }],
    apple: [{ url: "/watchPotLogoNoBg.png", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-paper text-ink">
        <AuthGateScript />
        {children}
        <ToastProvider />
      </body>
    </html>
  );
}

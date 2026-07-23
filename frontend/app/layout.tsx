import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/AuthContext";
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
  title: "Legal AI — AI Legal Intelligence Platform for India",
  description:
    "Legal AI is an AI legal associate for law firms, agencies, and legal professionals. Document intelligence, cited legal research, drafting, and multilingual support — with safety guardrails.",
  keywords: [
    "legal AI",
    "AI legal assistant",
    "Indian legal research",
    "legal document analysis",
    "contract drafting AI",
    "law firm software",
  ],
  openGraph: {
    title: "Legal AI — AI Legal Intelligence Platform",
    description:
      "The AI legal associate your firm can trust. Cited research, document intelligence, and multilingual support for legal professionals.",
    type: "website",
  },
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
      <body className="min-h-full flex flex-col">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

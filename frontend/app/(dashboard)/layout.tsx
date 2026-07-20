"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  // Firm management pages (dashboard, cases, drafts, contacts, knowledge,
  // team, admin) are for lawyers only. Public users only get "My documents"
  // here - everything else (chat + chat history) lives at /app.
  useEffect(() => {
    if (isLoading || !user) return;
    if (user.role === "public" && !pathname?.startsWith("/documents")) {
      router.replace("/app");
    }
  }, [isLoading, user, pathname, router]);

  // Close the mobile drawer automatically whenever the route changes.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0906] text-[#8a7c68]">
        Loading...
      </div>
    );
  }

  const navItem = (href: string, label: string) => (
    <Link
      href={href}
      className={`rounded-lg px-3 py-2 text-sm ${
        pathname === href || pathname?.startsWith(`${href}/`)
          ? "bg-[#c9a96e]/15 text-[#f0e6cc]"
          : "text-[#8a7c68] hover:text-[#c9a96e]"
      }`}
    >
      {label}
    </Link>
  );

  const isPublic = user.role === "public";

  const sidebarContent = (
    <>
      <h2 className="mb-1 text-lg font-bold text-[#f0e6cc]">⚖️ Legal AI</h2>
      <p className="mb-6 text-xs text-[#5a4f3f]">{isPublic ? "Public account" : user.firm_name}</p>

      <nav className="flex flex-col gap-1">
        {isPublic ? (
          <>
            {navItem("/app", "Ask a question")}
            {navItem("/documents", "My documents")}
          </>
        ) : (
          <>
            {navItem("/dashboard", "Dashboard")}
            {navItem("/app", "Ask a question")}
            {navItem("/cases", "Cases")}
            {navItem("/documents", "Documents")}
            {navItem("/drafts", "Drafts")}
            {navItem("/contacts", "Contacts")}
            {navItem("/knowledge", "Knowledge")}
            {navItem("/settings", "Settings")}
          </>
        )}
      </nav>

      <div className="mt-8 border-t border-[#c9a96e]/10 pt-4">
        <p className="mb-2 text-xs text-[#5a4f3f]">
          {user.full_name} · {user.role}
        </p>
        <button
          onClick={() => {
            logout();
            router.push("/login");
          }}
          className="w-full rounded-lg border border-[#c9a96e]/15 py-2 text-left text-xs text-[#8a7c68] hover:text-[#c9a96e]"
        >
          Log out
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#0b0906] text-[#e0d2ba] md:flex-row">
      {/* Mobile top bar: hamburger + brand, only shown below md */}
      <div className="flex items-center justify-between border-b border-[#c9a96e]/10 p-4 md:hidden">
        <h2 className="text-lg font-bold text-[#f0e6cc]">⚖️ Legal AI</h2>
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open menu"
          className="rounded-lg border border-[#c9a96e]/15 px-3 py-2 text-[#c9a96e]"
        >
          ☰
        </button>
      </div>

      {/* Mobile drawer + backdrop */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-64 max-w-[80vw] overflow-y-auto border-r border-[#c9a96e]/10 bg-[#0b0906] p-4">
            <button
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close menu"
              className="mb-4 rounded-lg border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#8a7c68]"
            >
              ✕ Close
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Desktop/tablet sidebar, always visible from md up */}
      <aside className="hidden w-56 shrink-0 border-r border-[#c9a96e]/10 p-4 md:block">
        {sidebarContent}
      </aside>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">{children}</main>
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Team management now lives in Settings -> Team. This route only exists so
// old links/bookmarks keep working.
export default function TeamPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/settings?tab=team");
  }, [router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-[#8a7c68]">
      Redirecting to Settings...
    </div>
  );
}

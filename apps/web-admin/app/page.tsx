"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";

export default function Home() {
  const { session, isLoading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    // Cleaner/maintenance logins have no access to the dashboard (host-only route,
    // see apps/api-server/src/routes/dashboard.ts) — land them on their task list instead.
    const canSeeDashboard = session.role === "owner" || session.role === "manager";
    router.replace(canSeeDashboard ? "/dashboard" : "/tasks");
  }, [isLoading, session, router]);

  return null;
}

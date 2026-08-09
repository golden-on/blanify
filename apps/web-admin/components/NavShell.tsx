"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, Inbox, LogOut } from "lucide-react";
import { useSession } from "@/lib/session";

const NAV_ITEMS = [
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/inbox", label: "Inbox", icon: Inbox },
];

export function NavShell({ children }: { children: React.ReactNode }) {
  const { session, isLoading, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!session && pathname !== "/login" && pathname !== "/") {
      router.replace("/login");
    }
  }, [isLoading, session, pathname, router]);

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-neutral-500">Loading...</div>;
  }

  if (!session) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 p-4">
        <div className="mb-6 px-2 text-lg font-semibold">Blanify</div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium ${
                pathname.startsWith(href) ? "bg-neutral-200 text-neutral-900" : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => {
            logout();
            router.push("/login");
          }}
          className="flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
        >
          <LogOut size={18} />
          Log out
        </button>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Search,
  FileText,
  FileUser,
  CheckSquare,
  CalendarClock,
  Clock,
  Inbox,
  BarChart3,
  Settings,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/discover", label: "Discover", icon: Search },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/resumes", label: "Resumes", icon: FileUser },
  { href: "/approve", label: "Approve & Send", icon: CheckSquare },
  { href: "/scheduled", label: "Scheduled", icon: CalendarClock },
  { href: "/followups", label: "Follow-ups", icon: Clock },
  { href: "/inbox", label: "Reply inbox", icon: Inbox },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-6 py-5 border-b border-slate-200">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white">
          <Zap className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-900">Apping God</div>
          <div className="text-xs text-slate-500">cold outreach</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
        {nav.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 px-6 py-3 text-xs text-slate-500">
        <div className="font-medium text-slate-700">Abhinav Kumar</div>
        <div>IIT Bombay • 2027</div>
      </div>
    </aside>
  );
}

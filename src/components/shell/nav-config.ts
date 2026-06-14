import {
  Activity,
  BarChart3,
  Boxes,
  Camera,
  LayoutDashboard,
  Plug,
  ScrollText,
  Settings,
  Shield,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  /** Return true if pathname matches (for nested routes). */
  isActive: (pathname: string) => boolean;
};

export const mainNav: NavItem[] = [
  {
    href: "/dashboard",
    label: "Home",
    shortLabel: "Home",
    icon: LayoutDashboard,
    isActive: (p) => p === "/dashboard" || p === "/",
  },
  {
    href: "/monitoring",
    label: "Dashboard",
    shortLabel: "Dash",
    icon: BarChart3,
    isActive: (p) => p.startsWith("/monitoring"),
  },
  {
    href: "/pots",
    label: "Pots",
    shortLabel: "Pots",
    icon: Boxes,
    isActive: (p) => p.startsWith("/pots"),
  },
  {
    href: "/snapshots",
    label: "Backups",
    shortLabel: "Backup",
    icon: Camera,
    isActive: (p) => p.startsWith("/snapshots"),
  },
  {
    href: "/events",
    label: "Events",
    shortLabel: "Events",
    icon: Activity,
    isActive: (p) => p.startsWith("/events"),
  },
  {
    href: "/log-wall",
    label: "Log wall",
    shortLabel: "Logs",
    icon: ScrollText,
    isActive: (p) => p.startsWith("/log-wall"),
  },
  {
    href: "/threat-intel",
    label: "Threat intel",
    shortLabel: "Intel",
    icon: Shield,
    isActive: (p) => p.startsWith("/threat-intel"),
  },
  {
    href: "/tools",
    label: "Tools",
    shortLabel: "Tools",
    icon: Wrench,
    isActive: (p) => p.startsWith("/tools"),
  },
  {
    href: "/integrations",
    label: "Integrations",
    shortLabel: "SIEM",
    icon: Plug,
    isActive: (p) => p.startsWith("/integrations"),
  },
  {
    href: "/settings",
    label: "Settings",
    shortLabel: "Settings",
    icon: Settings,
    isActive: (p) => p.startsWith("/settings"),
  },
];

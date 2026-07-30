import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, Compass, Home, Rocket, Wallet, type LucideIcon } from "lucide-react";

export const X_POST_TEMPLATE_URL = `https://x.com/intent/post?text=${encodeURIComponent("@linkrcash ")}`;
export const X_PROFILE_URL = "https://x.com/linkrcash";

const MOBILE_BOTTOM_NAV: ReadonlyArray<{
  exact?: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
}> = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/launch", label: "Launch", icon: Rocket },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/app", label: "Dashboard", icon: Wallet },
];

export function PublicMobileBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="sm-mobile-bottom-tabs" aria-label="Primary mobile navigation">
      {MOBILE_BOTTOM_NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = exact
          ? pathname === href
          : pathname === href || pathname.startsWith(href + "/");

        return (
          <Link key={href} to={href as never} data-active={active}>
            <Icon aria-hidden="true" size={20} strokeWidth={2.35} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

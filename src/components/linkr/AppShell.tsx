import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Compass,
  DollarSign,
  Droplets,
  Gift,
  History,
  Home,
  Images,
  KeyRound,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
  Terminal,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Logo } from "./Logo";
import { useAuth } from "@/hooks/use-auth";
import { useEnsureUserBootstrap } from "@/hooks/use-ensure-user-bootstrap";
import { supabase } from "@/integrations/supabase/client";

type DashboardTheme = "light" | "dark";

const NAV: ReadonlyArray<{
  exact?: boolean;
  icon: LucideIcon;
  label: string;
  to: string;
}> = [
  { to: "/app", label: "Home", icon: Home, exact: true },
  { to: "/app/terminal", label: "Terminal", icon: Terminal },
  { to: "/app/wallet", label: "Wallets", icon: Wallet },
  { to: "/app/scheduler", label: "Scheduler", icon: CalendarClock },
  { to: "/app/explore", label: "Explore", icon: Compass },
  { to: "/app/earnings", label: "Earnings", icon: DollarSign },
  { to: "/app/airdrops", label: "Airdrops", icon: Gift },
  { to: "/app/pools", label: "Pools", icon: Droplets },
  { to: "/app/nfts", label: "NFTs", icon: Images },
  { to: "/app/api-keys", label: "Agents", icon: KeyRound },
  { to: "/app/history", label: "History", icon: History },
  { to: "/app/actions", label: "To confirm", icon: CheckCircle2 },
  { to: "/app/settings", label: "Rules", icon: ShieldCheck },
];

const DASHBOARD_THEME_STORAGE_KEY = "linkr-dashboard-theme";

function getStoredDashboardTheme(): DashboardTheme {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(DASHBOARD_THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

function isDashboardTheme(value: unknown): value is DashboardTheme {
  return value === "light" || value === "dark";
}

export function AppShell() {
  const { user } = useAuth();
  useEnsureUserBootstrap(user);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dashboardTheme, setDashboardTheme] = useState<DashboardTheme>(getStoredDashboardTheme);
  const [themeSaving, setThemeSaving] = useState(false);

  const themeQuery = useQuery({
    queryKey: ["dashboard-theme", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("dashboard_theme")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (error) return null;

      return isDashboardTheme(data?.dashboard_theme) ? data.dashboard_theme : null;
    },
  });

  useEffect(() => {
    if (!themeQuery.data) return;
    setDashboardTheme(themeQuery.data);
    window.localStorage.setItem(DASHBOARD_THEME_STORAGE_KEY, themeQuery.data);
  }, [themeQuery.data]);

  useEffect(() => {
    document.body.dataset.dashboardTheme = dashboardTheme;
    document.documentElement.style.colorScheme = dashboardTheme;
    return () => {
      delete document.body.dataset.dashboardTheme;
      document.documentElement.style.colorScheme = "";
    };
  }, [dashboardTheme]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileMenuOpen]);

  const username = (user?.user_metadata?.user_name as string | undefined) ?? user?.email ?? "you";
  const avatar = user?.user_metadata?.avatar_url as string | undefined;
  const nextDashboardTheme: DashboardTheme = dashboardTheme === "dark" ? "light" : "dark";
  const ThemeIcon = dashboardTheme === "dark" ? Sun : Moon;
  const themeLabel = dashboardTheme === "dark" ? "Light mode" : "Dark mode";

  async function toggleDashboardTheme() {
    if (!user || themeSaving) return;

    const previous = dashboardTheme;
    const next = nextDashboardTheme;
    setDashboardTheme(next);
    window.localStorage.setItem(DASHBOARD_THEME_STORAGE_KEY, next);
    setThemeSaving(true);

    const { error } = await supabase
      .from("profiles")
      .upsert({ user_id: user.id, dashboard_theme: next }, { onConflict: "user_id" });

    setThemeSaving(false);

    if (error) {
      setDashboardTheme(previous);
      window.localStorage.setItem(DASHBOARD_THEME_STORAGE_KEY, previous);
      toast.error("Could not save dashboard theme");
      return;
    }

    toast.success(next === "dark" ? "Dark dashboard enabled" : "Light dashboard enabled");
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  function renderNavLinks(onSelect?: () => void) {
    return NAV.map(({ to, label, exact, icon: Icon }) => {
      const active = exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");
      return (
        <Link key={to} to={to as never} data-active={active} onClick={onSelect}>
          <span aria-hidden="true">
            <Icon size={18} strokeWidth={2.2} />
          </span>
          <b>{label}</b>
        </Link>
      );
    });
  }

  return (
    <div className="sm-app-shell" data-dashboard-theme={dashboardTheme}>
      <aside className="sm-app-sidebar">
        <div className="sm-app-sidebar-brand">
          <Logo to="/app" />
          <div className="sm-app-sidebar-actions" aria-label="Dashboard quick actions">
            <Link className="sm-app-home-link" to="/" aria-label="Open homepage" title="Homepage">
              <ArrowLeft aria-hidden="true" size={17} strokeWidth={2.4} />
            </Link>
            <button
              className="sm-app-theme-toggle"
              type="button"
              onClick={toggleDashboardTheme}
              disabled={themeSaving}
              aria-label={"Switch dashboard to " + nextDashboardTheme + " mode"}
              title={themeLabel}
            >
              <ThemeIcon aria-hidden="true" size={18} strokeWidth={2.3} />
            </button>
          </div>
        </div>

        <nav className="sm-app-nav" aria-label="App">
          {renderNavLinks()}
        </nav>

        <div className="sm-app-user">
          {avatar ? <img src={avatar} alt="" /> : <span>{username.slice(0, 1).toUpperCase()}</span>}
          <div>
            <strong>@{username}</strong>
            <small>X account connected</small>
          </div>
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="sm-app-main">
        <div className="sm-app-mobile-bar">
          <button
            className="sm-app-mobile-menu-button"
            type="button"
            aria-expanded={mobileMenuOpen}
            aria-controls="sm-app-mobile-menu"
            aria-label={mobileMenuOpen ? "Close app navigation" : "Open app navigation"}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? (
              <X aria-hidden="true" size={19} strokeWidth={2.4} />
            ) : (
              <>
                <Menu aria-hidden="true" size={19} strokeWidth={2.4} />
                <span>Menu</span>
              </>
            )}
          </button>
          <Logo to="/app" />
          <Link className="sm-app-mobile-home-link" to="/" aria-label="Back to homepage">
            <ArrowLeft aria-hidden="true" size={16} strokeWidth={2.4} />
            <span>Home</span>
          </Link>
        </div>
        <button
          className="sm-app-mobile-scrim"
          type="button"
          aria-label="Close app navigation"
          data-open={mobileMenuOpen}
          tabIndex={mobileMenuOpen ? 0 : -1}
          onClick={() => setMobileMenuOpen(false)}
        />
        <aside
          className="sm-app-mobile-menu"
          data-open={mobileMenuOpen}
          id="sm-app-mobile-menu"
          aria-label="Mobile app navigation"
          aria-hidden={!mobileMenuOpen}
        >
          <div className="sm-app-mobile-menu-head">
            <Logo to="/app" />
            <button
              type="button"
              aria-label="Close app navigation"
              onClick={() => setMobileMenuOpen(false)}
            >
              <X aria-hidden="true" size={18} strokeWidth={2.5} />
            </button>
          </div>
          <Link className="sm-app-mobile-home-link" to="/">
            <ArrowLeft aria-hidden="true" size={16} strokeWidth={2.4} />
            <span>Homepage</span>
          </Link>
          <button
            className="sm-app-mobile-theme-toggle"
            type="button"
            onClick={toggleDashboardTheme}
            disabled={themeSaving}
          >
            <ThemeIcon aria-hidden="true" size={17} strokeWidth={2.2} />
            <span>{themeLabel}</span>
          </button>
          <nav className="sm-app-nav" aria-label="Mobile app sections">
            {renderNavLinks(() => setMobileMenuOpen(false))}
          </nav>
          <div className="sm-app-user">
            {avatar ? (
              <img src={avatar} alt="" />
            ) : (
              <span>{username.slice(0, 1).toUpperCase()}</span>
            )}
            <div>
              <strong>@{username}</strong>
              <small>X account connected</small>
            </div>
            <button type="button" onClick={signOut}>
              Sign out
            </button>
          </div>
        </aside>
        <div className="sm-app-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

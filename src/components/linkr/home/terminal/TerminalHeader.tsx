import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const NAV_ITEMS = [
  { href: "/", label: "Home", route: true },
  { href: "/explore", label: "Explore", route: true },
  { href: "/activity", label: "Activity", route: true },
  { href: "/#workflow", label: "Docs", route: false },
] as const;

export function TerminalHeader() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="lkt-header">
      <div className="lkt-header-inner">
        <Link to="/" className="lkt-brand" aria-label="Linkr home">
          <img src="/linkr-logo.png" alt="" />
          <span>linkr</span>
        </Link>

        <nav className="lkt-nav" aria-label="Primary">
          {NAV_ITEMS.map((item) =>
            item.route ? (
              <Link key={item.href} to={item.href as never} data-active={pathname === item.href}>
                {item.label}
              </Link>
            ) : (
              <a key={item.href} href={item.href} data-active={false}>
                {item.label}
              </a>
            ),
          )}
        </nav>

        <div className="lkt-header-actions">
          <Link to={user ? "/app" : "/auth"} className="lkt-cta">
            <span>{user ? "Open Dashboard" : "Launch Linkr"}</span>
            <ArrowUpRight aria-hidden="true" size={16} strokeWidth={2.6} />
          </Link>
          <button
            className="lkt-menu-btn"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="lkt-mobile-nav"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <X aria-hidden="true" size={18} strokeWidth={2.4} />
            ) : (
              <Menu aria-hidden="true" size={18} strokeWidth={2.4} />
            )}
          </button>
        </div>
      </div>

      <nav
        className="lkt-mobile-nav"
        id="lkt-mobile-nav"
        data-open={menuOpen}
        aria-hidden={!menuOpen}
        aria-label="Mobile"
      >
        {NAV_ITEMS.map((item) =>
          item.route ? (
            <Link key={item.href} to={item.href as never} onClick={() => setMenuOpen(false)}>
              {item.label}
            </Link>
          ) : (
            <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
              {item.label}
            </a>
          ),
        )}
        <div className="lkt-mobile-nav-legal" aria-label="Legal">
          <Link to="/terms-of-service" onClick={() => setMenuOpen(false)}>
            Terms
          </Link>
          <Link to="/privacy-policy" onClick={() => setMenuOpen(false)}>
            Privacy
          </Link>
        </div>
      </nav>
    </header>
  );
}

import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  LayoutDashboard,
  LogOut,
  Menu,
  UserRound,
  X,
} from "lucide-react";
import { Logo } from "./Logo";
import { useAuth } from "@/hooks/use-auth";
import { FALLBACK_LINKR_CA, useLinkrTokenCa } from "@/hooks/use-linkr-token-ca";
import { PublicMobileBottomNav, X_POST_TEMPLATE_URL, X_PROFILE_URL } from "./PublicMobileBottomNav";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { copyTextToClipboard } from "@/lib/clipboard";
import { normalizeProfileHandle } from "@/lib/linkr/profile-links";
import { authSearchFor } from "@/lib/linkr/auth-return";

const NAV_ITEMS = [
  { href: "/", label: "Home", exact: true },
  { href: "/launch", label: "Launch" },
  { href: "/explore", label: "Explore" },
  { href: "/nfts", label: "NFTs" },
  { href: "/activity", label: "Activity" },
  { href: "/docs", label: "Docs" },
  { href: "/agent-api", label: "Agent API" },
] as const;

function XLogoMark() {
  return (
    <svg aria-hidden="true" className="sm-header-x-mark" viewBox="0 0 24 24" focusable="false">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

type MarketingHeaderProps = {
  onMobileMenuOpenChange?: (open: boolean) => void;
};

export function MarketingHeader({ onMobileMenuOpenChange }: MarketingHeaderProps = {}) {
  const location = useRouterState({ select: (s) => s.location });
  const pathname = location.pathname;
  const authSearch = authSearchFor(location.href);
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copiedTokenCa, setCopiedTokenCa] = useState(false);
  const [tokenCaExpanded, setTokenCaExpanded] = useState(false);
  const copyResetTimeoutRef = useRef<number | undefined>(undefined);
  const linkrCaQuery = useLinkrTokenCa();
  const profileQuery = useQuery({
    queryKey: ["header-profile", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("twitter_username,twitter_profile_image_url")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const username =
    profileQuery.data?.twitter_username ??
    (user?.user_metadata?.user_name as string | undefined) ??
    (user?.user_metadata?.preferred_username as string | undefined) ??
    user?.email ??
    "you";
  const avatar =
    profileQuery.data?.twitter_profile_image_url ??
    (user?.user_metadata?.avatar_url as string | undefined) ??
    (user?.user_metadata?.picture as string | undefined);
  const displayUsername = username.includes("@") ? username : "@" + username;
  const profileUsername = normalizeProfileHandle(username);
  const linkrCa = linkrCaQuery.data ?? FALLBACK_LINKR_CA;
  const compactLinkrCa = compactTokenCa(linkrCa);

  useEffect(() => {
    if (!menuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    onMobileMenuOpenChange?.(menuOpen);
    return () => onMobileMenuOpenChange?.(false);
  }, [menuOpen, onMobileMenuOpenChange]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  async function copyHeaderTokenCa() {
    const copied = await copyTextToClipboard(linkrCa);
    if (!copied) {
      setCopiedTokenCa(false);
      return;
    }

    setCopiedTokenCa(true);

    if (copyResetTimeoutRef.current) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }

    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopiedTokenCa(false);
      copyResetTimeoutRef.current = undefined;
    }, 1_600);
  }

  function toggleHeaderTokenCa() {
    setTokenCaExpanded((expanded) => !expanded);
  }

  return (
    <header className="sm-marketing-header">
      <div className="sm-marketing-header-inner">
        <Logo />

        <nav className="sm-marketing-nav" aria-label="Marketing">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const isRoute = !item.href.includes("#");

            return isRoute ? (
              <Link key={item.href} to={item.href as never} data-active={active}>
                {item.label}
              </Link>
            ) : (
              <a key={item.href} href={item.href} data-active={active}>
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="sm-header-actions">
          <div
            className="sm-header-token-pill"
            title={linkrCa}
            data-copied={copiedTokenCa}
            data-expanded={tokenCaExpanded}
            data-loading={linkrCaQuery.isFetching}
          >
            <button
              className="sm-header-token-symbol"
              type="button"
              aria-expanded={tokenCaExpanded}
              aria-controls="sm-header-token-details"
              aria-label={tokenCaExpanded ? "Hide LINKR token CA" : "Show LINKR token CA"}
              onClick={toggleHeaderTokenCa}
            >
              $LINKR
            </button>
            <span
              className="sm-header-token-details"
              id="sm-header-token-details"
              aria-hidden={!tokenCaExpanded}
            >
              <code className="sm-header-token-ca">
                <span className="sm-header-token-ca-full">{linkrCa}</span>
                <span className="sm-header-token-ca-short">{compactLinkrCa}</span>
              </code>
              <button
                className="sm-header-token-copy"
                type="button"
                onClick={copyHeaderTokenCa}
                aria-label={copiedTokenCa ? "LINKR token CA copied" : "Copy LINKR token CA"}
                tabIndex={tokenCaExpanded ? 0 : -1}
              >
                {copiedTokenCa ? (
                  <Check size={16} strokeWidth={2.7} />
                ) : (
                  <Copy size={16} strokeWidth={2.45} />
                )}
              </button>
            </span>
          </div>
          <a
            className="sm-header-primary"
            href={X_POST_TEMPLATE_URL}
            target="_blank"
            rel="noreferrer"
          >
            Say Hello
            <ArrowUpRight aria-hidden="true" size={19} strokeWidth={2.6} />
          </a>
          {!user && (
            <Link className="sm-header-login" to="/auth" search={authSearch}>
              Log In
            </Link>
          )}
          {user && (
            <Link className="sm-header-dashboard" to="/app">
              dashboard
              <LayoutDashboard aria-hidden="true" size={18} strokeWidth={2.5} />
            </Link>
          )}
          {user && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                className="sm-header-user-pill"
                aria-label={"Open " + displayUsername + " menu"}
              >
                {avatar ? (
                  <img className="sm-header-user-avatar" src={avatar} alt="" />
                ) : (
                  <span className="sm-header-user-avatar" aria-hidden="true">
                    {username.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="sm-header-user-name">{displayUsername}</span>
                <ChevronDown
                  className="sm-header-user-chevron"
                  aria-hidden="true"
                  size={16}
                  strokeWidth={2.6}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={18} className="sm-header-user-menu">
                <DropdownMenuItem asChild className="sm-header-user-menu-item">
                  <Link to="/app">
                    <LayoutDashboard aria-hidden="true" size={17} strokeWidth={2.5} />
                    Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="sm-header-user-menu-item">
                  {profileUsername ? (
                    <Link to="/u/$username" params={{ username: profileUsername }}>
                      <UserRound aria-hidden="true" size={17} strokeWidth={2.5} />
                      Profile
                    </Link>
                  ) : (
                    <Link to="/app/settings">
                      <UserRound aria-hidden="true" size={17} strokeWidth={2.5} />
                      Profile
                    </Link>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="sm-header-user-menu-item sm-header-user-menu-logout"
                  onSelect={signOut}
                >
                  <LogOut aria-hidden="true" size={17} strokeWidth={2.5} />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <a
            className="sm-header-x-button"
            href={X_PROFILE_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Open Linkr on X"
          >
            <XLogoMark />
          </a>
          <button
            className="sm-mobile-menu-button"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="sm-mobile-menu"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <X aria-hidden="true" size={19} strokeWidth={2.4} />
            ) : (
              <Menu aria-hidden="true" size={19} strokeWidth={2.4} />
            )}
          </button>
        </div>
      </div>

      <div
        className="sm-mobile-menu"
        data-open={menuOpen}
        id="sm-mobile-menu"
        aria-hidden={!menuOpen}
      >
        <div className="sm-mobile-menu-brand">
          <Logo />
          <button type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)}>
            <X aria-hidden="true" size={24} strokeWidth={2.4} />
          </button>
        </div>
        <nav aria-label="Mobile marketing">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const isRoute = !item.href.includes("#");

            return isRoute ? (
              <Link
                key={item.href}
                to={item.href as never}
                data-active={active}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
            ) : (
              <a
                key={item.href}
                href={item.href}
                data-active={active}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
        <div className="sm-mobile-menu-actions">
          <Link to="/launch" onClick={() => setMenuOpen(false)}>
            Launch a Coin
          </Link>
          {user ? (
            <Link to="/app" onClick={() => setMenuOpen(false)}>
              Open Dashboard
            </Link>
          ) : (
            <Link to="/auth" search={authSearch} onClick={() => setMenuOpen(false)}>
              Log In
            </Link>
          )}
          <a
            className="sm-mobile-menu-x-action"
            href={X_POST_TEMPLATE_URL}
            target="_blank"
            rel="noreferrer"
          >
            Start on X
          </a>
          {user && (
            <button type="button" onClick={signOut}>
              Log out
            </button>
          )}
        </div>
        <div className="sm-mobile-menu-legal" aria-label="Legal">
          <Link to="/terms-of-service" onClick={() => setMenuOpen(false)}>
            Terms
          </Link>
          <Link to="/privacy-policy" onClick={() => setMenuOpen(false)}>
            Privacy
          </Link>
        </div>
      </div>

      <PublicMobileBottomNav />
    </header>
  );
}

function compactTokenCa(value: string) {
  const tokenCa = value.trim();
  if (!tokenCa) return FALLBACK_LINKR_CA;
  if (tokenCa.length <= 14) return tokenCa;
  return `${tokenCa.slice(0, 4)}...${tokenCa.slice(-4)}`;
}

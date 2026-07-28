import { Link } from "@tanstack/react-router";

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="sm-logo group" aria-label="Linkr home">
      <div className="sm-logo-mark" aria-hidden="true">
        <img src="/linkr-logo.png" alt="" />
      </div>
      <span>linkr</span>
    </Link>
  );
}

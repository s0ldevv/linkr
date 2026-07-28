import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const LINKR_TERMS_VERSION = "2026-07-12";
const LOCAL_ACCEPTANCE_KEY = `linkr-entry-gate-accepted-${LINKR_TERMS_VERSION}`;
const MINIMUM_ACCESS_CHECK_MS = 1_000;

const ENTRY_POINTS = [
  "Linkr is an independent interface for a permissionless protocol. Smart contracts are experimental and execute as written.",
  "Linkr is not affiliated with any network, company, token, or brand shown in the app.",
  "Tokens are user-created. Listings are not endorsements, vetting, or financial advice.",
  "Token trading is volatile and can result in total loss. Never risk more than you can afford to lose.",
  "Market data comes from indexers and may lag or differ from on-chain state.",
  "By continuing, you confirm that using Linkr is lawful where you are.",
];

type AppEntryGateProps = {
  authLoading: boolean;
  children: ReactNode;
  user: User | null | undefined;
};

export function AppEntryGate({ authLoading, children, user }: AppEntryGateProps) {
  const queryClient = useQueryClient();
  const checkboxRef = useRef<HTMLInputElement | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [localAccepted, setLocalAccepted] = useState<boolean | null>(null);
  const [minimumCheckElapsed, setMinimumCheckElapsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id, "entry-gate"],
    enabled: !authLoading && !!user?.id && !accepted && localAccepted === false,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("terms_accepted_at, terms_accepted_version")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const profileAccepted =
    !!profileQuery.data?.terms_accepted_at &&
    profileQuery.data.terms_accepted_version === LINKR_TERMS_VERSION;
  const hasAcceptedCurrentTerms = localAccepted === true || accepted || profileAccepted;
  const isCheckingAcceptance =
    localAccepted === null ||
    (authLoading && !hasAcceptedCurrentTerms) ||
    (!!user?.id && localAccepted === false && !accepted && profileQuery.isLoading);
  const showAccessCheck = isCheckingAcceptance || !minimumCheckElapsed;

  useEffect(() => {
    if (typeof window === "undefined") return;
    setLocalAccepted(window.localStorage.getItem(LOCAL_ACCEPTANCE_KEY) === "true");
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setMinimumCheckElapsed(true);
    }, MINIMUM_ACCESS_CHECK_MS);

    return () => window.clearTimeout(timerId);
  }, []);

  useEffect(() => {
    if (!profileAccepted || typeof window === "undefined") return;
    window.localStorage.setItem(LOCAL_ACCEPTANCE_KEY, "true");
    setLocalAccepted(true);
  }, [profileAccepted]);

  useEffect(() => {
    if (hasAcceptedCurrentTerms || showAccessCheck) return;

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    window.requestAnimationFrame(() => checkboxRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [hasAcceptedCurrentTerms, showAccessCheck]);

  if (showAccessCheck) {
    return (
      <div className="sm-entry-gate sm-entry-gate-loading" role="presentation">
        <section aria-live="polite" className="sm-entry-gate-panel" role="status">
          <div className="sm-entry-gate-heading">
            <p>Preparing Linkr</p>
            <h1>Checking access</h1>
          </div>

          <div className="sm-entry-gate-loading-row">
            <Loader2 aria-hidden="true" size={18} strokeWidth={2.2} />
            <span>One moment</span>
          </div>
        </section>
      </div>
    );
  }

  if (hasAcceptedCurrentTerms) return <>{children}</>;

  async function enterLinkr() {
    if (!understood || saving) return;
    setSaving(true);
    setSubmitError(null);

    const acceptedAt = new Date().toISOString();
    if (user?.id) {
      const { error } = await supabase.from("profiles").upsert(
        {
          user_id: user.id,
          terms_accepted_at: acceptedAt,
          terms_accepted_version: LINKR_TERMS_VERSION,
        },
        { onConflict: "user_id" },
      );

      if (error) {
        setSaving(false);
        setSubmitError(error.message);
        return;
      }
    }

    setSaving(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCAL_ACCEPTANCE_KEY, "true");
    }

    setLocalAccepted(true);
    setAccepted(true);
    if (user?.id) {
      queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
    }
  }

  return (
    <div className="sm-entry-gate" role="presentation">
      <section
        aria-describedby="sm-entry-gate-copy"
        aria-labelledby="sm-entry-gate-title"
        aria-modal="true"
        className="sm-entry-gate-panel"
        role="dialog"
      >
        <div className="sm-entry-gate-heading">
          <p>Before you enter</p>
          <h1 id="sm-entry-gate-title">Welcome to Linkr</h1>
        </div>

        <div className="sm-entry-gate-copy" id="sm-entry-gate-copy">
          {ENTRY_POINTS.map((point) => (
            <p key={point}>{point}</p>
          ))}
        </div>

        {profileQuery.isError ? (
          <div className="sm-entry-gate-alert" role="alert">
            <AlertTriangle aria-hidden="true" size={16} strokeWidth={2.2} />
            <span>We could not check your account status. Please try again in a moment.</span>
          </div>
        ) : null}

        {submitError ? (
          <div className="sm-entry-gate-alert" role="alert">
            <AlertTriangle aria-hidden="true" size={16} strokeWidth={2.2} />
            <span>{submitError}</span>
          </div>
        ) : null}

        <label className="sm-entry-gate-check">
          <input
            checked={understood}
            disabled={saving}
            onChange={(event) => setUnderstood(event.target.checked)}
            ref={checkboxRef}
            type="checkbox"
          />
          <span>
            I understand and accept the{" "}
            <Link to="/terms-of-service" target="_blank">
              Terms of Use
            </Link>
            .
          </span>
        </label>

        <button
          className="sm-entry-gate-button"
          disabled={!understood || saving || (!!user?.id && profileQuery.isLoading)}
          onClick={enterLinkr}
          type="button"
        >
          {saving || (!!user?.id && profileQuery.isLoading) ? (
            <>
              <Loader2 aria-hidden="true" size={17} strokeWidth={2.2} />
              Preparing
            </>
          ) : (
            "Enter Linkr"
          )}
        </button>
      </section>
    </div>
  );
}

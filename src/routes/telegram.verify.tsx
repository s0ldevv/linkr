import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, LockKeyhole, ShieldCheck, XCircle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type TelegramWebApp = {
  ready?: () => void;
  expand?: () => void;
  close?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  HapticFeedback?: {
    impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred?: (type: "error" | "success" | "warning") => void;
  };
};

type Challenge = {
  status: "pending" | "verified" | "expired" | "failed" | "cancelled";
  captcha_code: string;
  slider_target: number;
  attempts_remaining: number;
  expires_at: string;
  chat_title: string;
};

type VerifyResponse = {
  ok?: boolean;
  status?: Challenge["status"];
  challenge?: Challenge;
  invite_link?: string | null;
  error?: string;
  message?: string;
  attempts_remaining?: number;
};

const HOLD_DURATION_MS = 1500;

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export const Route = createFileRoute("/telegram/verify")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Verify with Linkr" },
      { name: "description", content: "Complete the Linkr Telegram group verification." },
      { name: "theme-color", content: "#111111" },
    ],
  }),
  component: TelegramVerifyPage,
});

function TelegramVerifyPage() {
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URL(window.location.href).searchParams.get("verification") ?? "";
  }, []);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [captcha, setCaptcha] = useState("");
  const [sliderComplete, setSliderComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    const configureTelegram = () => {
      const app = window.Telegram?.WebApp;
      app?.ready?.();
      app?.expand?.();
      app?.setHeaderColor?.("#111111");
      app?.setBackgroundColor?.("#111111");
    };

    if (window.Telegram?.WebApp) {
      configureTelegram();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-linkr-telegram-webapp="true"]',
    );
    if (existingScript) {
      existingScript.addEventListener("load", configureTelegram, { once: true });
      return () => existingScript.removeEventListener("load", configureTelegram);
    }

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.async = true;
    script.dataset.linkrTelegramWebapp = "true";
    script.addEventListener("load", configureTelegram, { once: true });
    document.head.appendChild(script);
    return () => script.removeEventListener("load", configureTelegram);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadChallenge() {
      if (!token) {
        setLoading(false);
        setError(
          "This verification link is missing. Go back to the Telegram group and tap Verify again.",
        );
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const { data, error: invokeError } = await supabase.functions.invoke<VerifyResponse>(
          "telegram-verify",
          { body: { action: "load", token } },
        );
        if (cancelled) return;
        if (invokeError) throw invokeError;
        if (!data?.ok || !data.challenge) throw new Error(readableVerifyError(data?.error));
        setChallenge(data.challenge);
        setVerified(data.challenge.status === "verified");
      } catch (loadError) {
        if (!cancelled) setError(readableError(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadChallenge();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!challenge?.expires_at || verified) return;
    const tick = () => {
      setSecondsLeft(
        Math.max(0, Math.ceil((new Date(challenge.expires_at).getTime() - Date.now()) / 1000)),
      );
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [challenge?.expires_at, verified]);

  useEffect(() => {
    if (!verified) return;

    let attempts = 0;
    let closeTimer: number | null = null;
    let browserFallbackTimer: number | null = null;
    const closeVerificationWindow = () => {
      const app = window.Telegram?.WebApp;
      if (app?.close) {
        app.close();
        browserFallbackTimer = window.setTimeout(() => window.close(), 300);
        return;
      }

      attempts += 1;
      if (attempts < 20) {
        closeTimer = window.setTimeout(closeVerificationWindow, 100);
        return;
      }

      window.close();
    };

    closeTimer = window.setTimeout(closeVerificationWindow, 200);
    return () => {
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      if (browserFallbackTimer !== null) window.clearTimeout(browserFallbackTimer);
    };
  }, [verified]);

  const captchaReady = captcha.trim().length >= 5;
  const canVerify =
    Boolean(challenge) && !loading && !verifying && !verified && sliderComplete && captchaReady;

  async function submitVerification() {
    if (!challenge || !canVerify) return;
    setVerifying(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<VerifyResponse>(
        "telegram-verify",
        { body: { action: "verify", token, captcha, sliderComplete } },
      );
      if (invokeError) throw invokeError;
      if (!data?.ok) {
        if (typeof data?.attempts_remaining === "number") {
          setChallenge((current) =>
            current ? { ...current, attempts_remaining: data.attempts_remaining ?? 0 } : current,
          );
        }
        throw new Error(data?.message || readableVerifyError(data?.error));
      }
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
      setVerified(true);
      setInviteLink(data.invite_link ?? null);
    } catch (verifyError) {
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("error");
      setSliderComplete(false);
      setCaptcha("");
      setError(readableError(verifyError));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="sm-auth-page telegram-verify-page min-h-screen">
      <main className="telegram-verify-shell">
        <section className="telegram-verify-panel" aria-label="Telegram group verification">
          {loading ? (
            <VerificationState
              icon={<Loader2 className="animate-spin" size={26} />}
              title="Loading check"
              text="Preparing your Telegram verification window."
            />
          ) : verified ? (
            <VerifiedState inviteLink={inviteLink} />
          ) : error && !challenge ? (
            <VerificationState
              icon={<XCircle size={28} />}
              title={/expired/i.test(error) ? "Link expired" : "Verification unavailable"}
              text={error}
              tone="error"
            />
          ) : challenge ? (
            <>
              <div className="telegram-verify-panel-top">
                <LockKeyhole size={26} strokeWidth={2.5} aria-hidden="true" />
                <div>
                  <strong>{challenge.chat_title}</strong>
                  <p>{formatExpiry(secondsLeft)}</p>
                </div>
              </div>

              <HoldToVerify
                complete={sliderComplete}
                disabled={verifying}
                onComplete={() => {
                  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
                  setSliderComplete(true);
                }}
              />

              <div className="telegram-verify-captcha" aria-label="Captcha">
                <div className="telegram-verify-captcha-code" aria-hidden="true">
                  {challenge.captcha_code.split("").map((character, index) => (
                    <span
                      key={`${character}-${index}`}
                      style={{
                        transform: `translateY(${index % 2 === 0 ? -2 : 2}px) rotate(${
                          index % 2 === 0 ? -5 : 5
                        }deg)`,
                      }}
                    >
                      {character}
                    </span>
                  ))}
                </div>
                <input
                  value={captcha}
                  onChange={(event) => setCaptcha(normalizeCaptchaInput(event.target.value))}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={5}
                  placeholder="Enter code"
                  aria-label="Enter captcha code"
                />
              </div>

              {error ? (
                <p className="telegram-verify-status" data-tone="error" role="alert">
                  {error}
                </p>
              ) : (
                <p className="telegram-verify-status" data-tone="muted">
                  {challenge.attempts_remaining} attempts remaining
                </p>
              )}

              <Button
                type="button"
                size="lg"
                disabled={!canVerify}
                onClick={submitVerification}
                className="telegram-verify-submit"
              >
                {verifying ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-5 w-5" />
                )}
                {verifying ? "Verifying..." : "Verify and enter"}
              </Button>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function HoldToVerify({
  complete,
  disabled,
  onComplete,
}: {
  complete: boolean;
  disabled: boolean;
  onComplete: () => void;
}) {
  const [progress, setProgress] = useState(complete ? 100 : 0);
  const [holding, setHolding] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const startProgressRef = useRef<number>(0);
  const activePointerRef = useRef<number | null>(null);
  const completedRef = useRef<boolean>(complete);

  useEffect(() => {
    completedRef.current = complete;
    if (complete) setProgress(100);
  }, [complete]);

  const cancelRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => () => cancelRaf(), [cancelRaf]);

  const startHold = useCallback(
    (pointerId: number, target: HTMLButtonElement) => {
      if (disabled || completedRef.current) return;
      if (activePointerRef.current !== null) return;
      activePointerRef.current = pointerId;
      try {
        target.setPointerCapture(pointerId);
      } catch (_) {
        /* noop */
      }
      setHolding(true);
      startedAtRef.current = performance.now();
      startProgressRef.current = 0;
      setProgress(0);
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
      const tick = () => {
        const elapsed = performance.now() - startedAtRef.current;
        const next = Math.min(100, (elapsed / HOLD_DURATION_MS) * 100);
        setProgress(next);
        if (next >= 100) {
          rafRef.current = null;
          completedRef.current = true;
          activePointerRef.current = null;
          setHolding(false);
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
          onComplete();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      cancelRaf();
      rafRef.current = requestAnimationFrame(tick);
    },
    [cancelRaf, disabled, onComplete],
  );

  const releaseHold = useCallback(
    (pointerId: number, target: HTMLButtonElement | null) => {
      if (activePointerRef.current !== pointerId) return;
      activePointerRef.current = null;
      cancelRaf();
      if (target && target.hasPointerCapture?.(pointerId)) {
        try {
          target.releasePointerCapture(pointerId);
        } catch (_) {
          /* noop */
        }
      }
      setHolding(false);
      if (!completedRef.current) {
        setProgress(0);
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("soft");
      }
    },
    [cancelRaf],
  );

  const style = { "--hold-progress": `${progress}%` } as CSSProperties;
  const state = complete ? "complete" : holding ? "holding" : "idle";
  const label = complete ? "Verified" : holding ? "Keep holding" : "Hold to verify";

  return (
    <div className="telegram-verify-hold" data-state={state}>
      <button
        type="button"
        className="telegram-verify-hold-button"
        style={style}
        data-state={state}
        disabled={disabled || complete}
        aria-label="Hold to complete the security check"
        aria-pressed={holding}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          startHold(event.pointerId, event.currentTarget);
        }}
        onPointerUp={(event) => {
          event.preventDefault();
          releaseHold(event.pointerId, event.currentTarget);
        }}
        onPointerLeave={(event) => releaseHold(event.pointerId, event.currentTarget)}
        onPointerCancel={(event) => releaseHold(event.pointerId, event.currentTarget)}
        onLostPointerCapture={(event) => releaseHold(event.pointerId, event.currentTarget)}
      >
        <span className="telegram-verify-hold-fill" aria-hidden="true" />
        <span className="telegram-verify-hold-label">
          {complete ? (
            <CheckCircle2 size={20} strokeWidth={2.8} aria-hidden="true" />
          ) : (
            <ShieldCheck size={20} strokeWidth={2.6} aria-hidden="true" />
          )}
          {label}
        </span>
      </button>
    </div>
  );
}

function VerificationState({
  icon,
  title,
  text,
  tone = "muted",
}: {
  icon: ReactNode;
  title: string;
  text: string;
  tone?: "muted" | "error";
}) {
  return (
    <div className="telegram-verify-state" data-tone={tone}>
      {icon}
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function VerifiedState({ inviteLink }: { inviteLink: string | null }) {
  return (
    <div className="telegram-verify-state telegram-verify-state-success" data-tone="success">
      <CheckCircle2 size={32} />
      <strong>Verified</strong>
      <p>Group access is unlocked. You can return to Telegram now.</p>
      {inviteLink ? (
        <div className="telegram-verify-actions">
          <Button asChild size="lg" className="telegram-verify-submit">
            <a href={inviteLink}>Open group</a>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function normalizeCaptchaInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
}

function formatExpiry(seconds: number | null): string {
  if (seconds === null) return "Verification window is active";
  if (seconds <= 0) return "This check is expiring now";
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return `Verification expires in ${minutes}:${remainder}`;
}

function readableError(error: unknown): string {
  if (error instanceof Error && error.message) return readableVerifyError(error.message);
  return "Verification could not continue. Open a fresh Linkr verification from Telegram.";
}

function readableVerifyError(error: unknown): string {
  const code = String(error ?? "").trim();
  if (!code)
    return "Verification could not continue. Open a fresh Linkr verification from Telegram.";
  if (/captcha_mismatch/i.test(code))
    return "That code did not match. Try the new check shown here.";
  if (/challenge_failed/i.test(code))
    return "Too many attempts. Open a fresh verification from Telegram.";
  if (/challenge_expired|expired/i.test(code))
    return "This verification expired. Open a fresh one from Telegram.";
  if (/challenge_not_pending|failed|cancelled/i.test(code)) {
    return "This verification is no longer active. Open a fresh one from Telegram.";
  }
  if (/telegram_unlock_failed/i.test(code)) {
    return "The check passed, but Telegram could not unlock the group yet.";
  }
  if (/not_found|missing_token/i.test(code)) return "This verification link is invalid or missing.";
  return code;
}

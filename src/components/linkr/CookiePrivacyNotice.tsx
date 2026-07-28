import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

const CONSENT_COOKIE = "linkr_cookie_consent_v1";
const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

type CookiePreferences = {
  analytics: boolean;
  necessary: true;
  preferences: boolean;
};

function hasSavedConsent() {
  return document.cookie
    .split(";")
    .map((value) => value.trim())
    .some((value) => value.startsWith(`${CONSENT_COOKIE}=`));
}

function saveConsent(preferences: CookiePreferences) {
  const value = encodeURIComponent(JSON.stringify(preferences));
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

export function CookiePrivacyNotice() {
  const [visible, setVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [preferences, setPreferences] = useState(true);

  useEffect(() => {
    if (hasSavedConsent()) return;

    let cancelled = false;
    let timer = 0;

    const revealWhenReady = () => {
      if (cancelled || hasSavedConsent()) return;

      const entryGateVisible = document.querySelector(".sm-entry-gate") !== null;
      const pageLoaderVisible =
        document.querySelector('.sm-rayo-loader[data-loaded="false"]') !== null;

      if (document.readyState !== "complete" || entryGateVisible || pageLoaderVisible) {
        timer = window.setTimeout(revealWhenReady, 250);
        return;
      }

      timer = window.setTimeout(() => {
        if (!cancelled && !hasSavedConsent()) setVisible(true);
      }, 350);
    };

    revealWhenReady();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  function finish(preferencesToSave: CookiePreferences) {
    saveConsent(preferencesToSave);
    setSettingsOpen(false);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <>
      <aside
        aria-describedby="sm-cookie-notice-copy"
        aria-labelledby="sm-cookie-notice-title"
        className="sm-cookie-notice"
        role="dialog"
      >
        <div className="sm-cookie-notice-copy">
          <p>Privacy, your call</p>
          <h2 id="sm-cookie-notice-title">A quick note about cookies</h2>
          <span id="sm-cookie-notice-copy">
            Linkr uses essential cookies to keep things running, plus optional cookies to understand
            how the app is used and remember what works for you.
          </span>
        </div>

        <div className="sm-cookie-notice-actions">
          <button
            type="button"
            onClick={() => finish({ necessary: true, analytics: false, preferences: false })}
          >
            Reject All
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)}>
            Customize
          </button>
          <button
            className="sm-cookie-button-primary"
            type="button"
            onClick={() => finish({ necessary: true, analytics: true, preferences: true })}
          >
            Accept All
          </button>
        </div>
      </aside>

      <AlertDialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="sm-cookie-settings-overlay" />
          <AlertDialog.Content className="sm-cookie-settings-modal">
            <AlertDialog.Cancel asChild>
              <button
                className="sm-cookie-settings-close"
                type="button"
                aria-label="Close privacy settings"
              >
                <X aria-hidden="true" size={18} strokeWidth={2.5} />
              </button>
            </AlertDialog.Cancel>

            <div className="sm-cookie-settings-heading">
              <p>Cookie controls</p>
              <AlertDialog.Title>Privacy Settings</AlertDialog.Title>
              <AlertDialog.Description>
                Customize your privacy settings here. You can choose which types of cookies and
                tracking technologies you allow.
              </AlertDialog.Description>
            </div>

            <div className="sm-cookie-settings-options">
              <CookieOption checked disabled label="Necessary" onChange={() => undefined} />
              <CookieOption checked={analytics} label="Analytics" onChange={setAnalytics} />
              <CookieOption checked={preferences} label="Preferences" onChange={setPreferences} />
            </div>

            <AlertDialog.Action asChild>
              <button
                className="sm-cookie-settings-save"
                type="button"
                onClick={() => finish({ necessary: true, analytics, preferences })}
              >
                Save changes
              </button>
            </AlertDialog.Action>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

function CookieOption({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="sm-cookie-option" data-disabled={disabled}>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="sm-cookie-option-check" aria-hidden="true">
        <Check size={15} strokeWidth={3} />
      </span>
      <span>{label}</span>
    </label>
  );
}

import { Download, Share2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type MobilePlatform = "android" | "ios";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_STORAGE_KEY = "linkr.mobileInstallBanner.dismissed.v1";

function getMobilePlatform(): MobilePlatform | null {
  if (typeof window === "undefined") return null;

  const navigatorWithHints = window.navigator as Navigator & {
    standalone?: boolean;
    userAgentData?: { mobile?: boolean; platform?: string };
  };
  const userAgent = navigatorWithHints.userAgent || "";
  const platform = navigatorWithHints.userAgentData?.platform || navigatorWithHints.platform || "";
  const maxTouchPoints = navigatorWithHints.maxTouchPoints || 0;
  const isiPadOS = platform === "MacIntel" && maxTouchPoints > 1;

  if (/android/i.test(userAgent) || /android/i.test(platform)) return "android";
  if (/iPad|iPhone|iPod/i.test(userAgent) || isiPadOS) return "ios";
  if (navigatorWithHints.userAgentData?.mobile) return "android";

  return null;
}

function isInstalledDisplayMode(): boolean {
  if (typeof window === "undefined") return false;

  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, "true");
  } catch {
    // Ignore storage failures; the close button should still hide the banner for this session.
  }
}

function registerInstallServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
  if (window.location.protocol !== "https:" && !localHostnames.has(window.location.hostname))
    return;

  const register = () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  };

  if (document.readyState === "complete") {
    register();
    return;
  }

  window.addEventListener("load", register, { once: true });
}

export function MobileInstallBanner() {
  const [platform, setPlatform] = useState<MobilePlatform | null>(null);
  const [visible, setVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const bannerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const detectedPlatform = getMobilePlatform();
    if (!detectedPlatform || isInstalledDisplayMode() || wasDismissed()) return;

    setPlatform(detectedPlatform);
    setVisible(true);
    registerInstallServiceWorker();

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const handleInstalled = () => {
      rememberDismissed();
      setVisible(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const banner = bannerRef.current;
    const body = document.body;
    const root = document.documentElement;

    if (!visible || !platform || !banner) {
      body.removeAttribute("data-mobile-install-banner");
      root.style.removeProperty("--sm-install-banner-height");
      return;
    }

    const syncBannerHeight = () => {
      root.style.setProperty("--sm-install-banner-height", `${banner.offsetHeight}px`);
    };

    body.setAttribute("data-mobile-install-banner", "visible");
    syncBannerHeight();

    const observer = "ResizeObserver" in window ? new ResizeObserver(syncBannerHeight) : undefined;
    observer?.observe(banner);
    window.addEventListener("resize", syncBannerHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncBannerHeight);
      body.removeAttribute("data-mobile-install-banner");
      root.style.removeProperty("--sm-install-banner-height");
    };
  }, [platform, visible]);

  const copy = useMemo(() => {
    if (platform === "ios") {
      return showInstructions
        ? "Tap Share, then Add to Home Screen."
        : "Add Linkr to your Home Screen.";
    }

    return showInstructions && !deferredPrompt
      ? "Open your browser menu, then tap Install app."
      : "Add Linkr to your Home Screen.";
  }, [deferredPrompt, platform, showInstructions]);

  if (!visible || !platform) return null;

  const Icon = platform === "ios" && showInstructions ? Share2 : Download;

  async function handleInstallClick() {
    if (platform === "android" && deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => null);
      setDeferredPrompt(null);

      if (choice?.outcome === "accepted") {
        rememberDismissed();
        setVisible(false);
        return;
      }
    }

    setShowInstructions(true);
  }

  function handleDismiss() {
    rememberDismissed();
    setVisible(false);
  }

  return (
    <div className="sm-install-banner" ref={bannerRef} role="region" aria-label="Install Linkr">
      <button className="sm-install-banner-main" type="button" onClick={handleInstallClick}>
        <span className="sm-install-banner-icon" aria-hidden="true">
          <Icon size={15} strokeWidth={2.5} />
        </span>
        <span className="sm-install-banner-copy">
          <strong>{copy}</strong>
          <small>{platform === "ios" ? "iOS shortcut" : "Android install"}</small>
        </span>
      </button>
      <button className="sm-install-banner-action" type="button" onClick={handleInstallClick}>
        Add
      </button>
      <button
        className="sm-install-banner-close"
        type="button"
        aria-label="Hide Home Screen prompt"
        onClick={handleDismiss}
      >
        <X size={15} strokeWidth={2.7} aria-hidden="true" />
      </button>
    </div>
  );
}

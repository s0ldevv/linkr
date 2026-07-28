import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export function RayoChrome() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isAppRoute = pathname.startsWith("/app");
  const [loaded, setLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    if (isAppRoute) return;

    let frame = 0;
    let exitTimer = 0;
    const start = window.performance.now();
    const duration = 1150;

    const tick = (time: number) => {
      const elapsed = Math.min(1, (time - start) / duration);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      setLoadProgress(Math.round(eased * 100));

      if (elapsed < 1) {
        frame = window.requestAnimationFrame(tick);
      } else {
        setLoadProgress(100);
        exitTimer = window.setTimeout(() => setLoaded(true), 180);
      }
    };

    frame = window.requestAnimationFrame(tick);

    const updateProgress = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      const next = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;
      setScrollProgress(Math.min(100, Math.max(0, next)));
    };

    updateProgress();
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(exitTimer);
      window.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
    };
  }, [isAppRoute]);

  if (isAppRoute) return null;

  return (
    <>
      <div className="sm-rayo-loader" data-loaded={loaded} aria-hidden="true">
        <div className="sm-rayo-loader__wrapper">
          <div className="sm-rayo-loader__content">
            <div className="sm-rayo-loader__count">
              <span className="count__text">{loadProgress}</span>
              <span className="count__percent">%</span>
            </div>
          </div>
        </div>
      </div>
      <div className="sm-rayo-scroll-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${scrollProgress / 100})` }} />
      </div>
      <a className="sm-rayo-top" href="#top" aria-label="Back to top">
        <span>{Math.round(scrollProgress)}</span>
      </a>
    </>
  );
}

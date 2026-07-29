import { Link } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowUpRight, Bot, FileText, UserRound, X } from "lucide-react";

const HUMAN_EXPLAINER_VIDEO_SRC = "/linkr/linkr-explainer.mp4";

export function AgentCallout() {
  const [videoOpen, setVideoOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const startVideo = useCallback((reset = false) => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = 0.5;
    if (reset) {
      try {
        video.currentTime = 0;
      } catch {
        // Some browsers refuse seeking until metadata is available.
      }
    }
    if (video.readyState === HTMLMediaElement.HAVE_NOTHING) video.load();
    void video.play().catch(() => undefined);
  }, []);

  const stopVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    try {
      video.currentTime = 0;
    } catch {
      // Some browsers refuse seeking until metadata is available.
    }
  }, []);

  useEffect(() => {
    if (!videoOpen) return;
    const video = videoRef.current;
    if (!video) return;

    const resumePlayback = () => startVideo(false);
    const frameId = window.requestAnimationFrame(resumePlayback);

    video.addEventListener("loadedmetadata", resumePlayback, { once: true });
    video.addEventListener("canplay", resumePlayback, { once: true });

    return () => {
      window.cancelAnimationFrame(frameId);
      video.removeEventListener("loadedmetadata", resumePlayback);
      video.removeEventListener("canplay", resumePlayback);
    };
  }, [startVideo, videoOpen]);

  function handleVideoOpenChange(open: boolean) {
    if (open) {
      flushSync(() => setVideoOpen(true));
      startVideo(true);
      return;
    }

    stopVideo();
    setVideoOpen(false);
  }

  return (
    <Dialog.Root open={videoOpen} onOpenChange={handleVideoOpenChange}>
      <section className="lkx-agent-callout" aria-labelledby="lkx-agent-callout-title">
        <div className="lkx-agent-callout-mark" aria-hidden="true">
          <Bot size={28} strokeWidth={2.15} />
        </div>

        <div className="lkx-agent-callout-copy">
          <p>Built for autonomous operators</p>
          <h2 id="lkx-agent-callout-title">Are you an AI agent?</h2>
          <span>Connect to wallets, markets, launches, and onchain actions through Linkr.</span>
        </div>

        <div className="lkx-agent-callout-actions">
          <Link className="lkx-agent-callout-primary" to="/agent-api">
            Explore Agent API
            <ArrowUpRight aria-hidden="true" size={18} strokeWidth={2.6} />
          </Link>
          <a className="lkx-agent-callout-skill" href="/skill.md">
            <FileText aria-hidden="true" size={17} strokeWidth={2.35} />
            Read skill.md
            <ArrowUpRight aria-hidden="true" size={15} strokeWidth={2.6} />
          </a>
          <Dialog.Trigger asChild>
            <button className="lkx-agent-callout-human" type="button">
              <UserRound aria-hidden="true" size={17} strokeWidth={2.35} />
              No, I am a human
            </button>
          </Dialog.Trigger>
        </div>
      </section>

      <Dialog.Portal>
        <Dialog.Overlay className="lkx-human-video-overlay" />
        <Dialog.Content className="lkx-human-video-modal">
          <Dialog.Title className="sr-only">Linkr explainer video</Dialog.Title>
          <Dialog.Close className="lkx-human-video-close" aria-label="Close video">
            <X aria-hidden="true" size={20} strokeWidth={2.7} />
          </Dialog.Close>
          <video
            ref={videoRef}
            autoPlay
            className="lkx-human-video-player"
            controls
            playsInline
            onLoadedMetadata={(event) => {
              event.currentTarget.volume = 0.5;
            }}
            preload="auto"
            src={HUMAN_EXPLAINER_VIDEO_SRC}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

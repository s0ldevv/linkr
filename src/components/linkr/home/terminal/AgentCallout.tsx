import { Link } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { ArrowUpRight, Bot, FileText, UserRound, X } from "lucide-react";

const HUMAN_EXPLAINER_VIDEO_SRC = "/linkr/linkr-explainer.mp4";

export function AgentCallout() {
  const [videoOpen, setVideoOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  function startVideo() {
    const video = videoRef.current;
    if (!video) return;

    video.volume = 0.5;
    video.currentTime = 0;
    void video.play().catch(() => undefined);
  }

  function stopVideo() {
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    video.currentTime = 0;
  }

  function handleVideoOpenChange(open: boolean) {
    setVideoOpen(open);

    if (open) {
      startVideo();
      return;
    }

    stopVideo();
  }

  return (
    <>
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
          <button
            className="lkx-agent-callout-human"
            type="button"
            onClick={() => handleVideoOpenChange(true)}
          >
            <UserRound aria-hidden="true" size={17} strokeWidth={2.35} />
            No, I am a human
          </button>
        </div>
      </section>

      <Dialog.Root open={videoOpen} onOpenChange={handleVideoOpenChange}>
        <Dialog.Portal forceMount>
          <Dialog.Overlay forceMount className="lkx-human-video-overlay" />
          <Dialog.Content forceMount className="lkx-human-video-modal">
            <Dialog.Title className="sr-only">Linkr explainer video</Dialog.Title>
            <Dialog.Close className="lkx-human-video-close" aria-label="Close video">
              <X aria-hidden="true" size={20} strokeWidth={2.7} />
            </Dialog.Close>
            <video
              ref={videoRef}
              className="lkx-human-video-player"
              controls
              playsInline
              onLoadedMetadata={(event) => {
                event.currentTarget.volume = 0.5;
              }}
              preload="metadata"
              src={HUMAN_EXPLAINER_VIDEO_SRC}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

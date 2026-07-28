import { useEffect, type RefObject } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Scroll-triggered animation layer for the marketing homepage, modeled on the
 * Rayo theme's GSAP setup:
 *
 * - [data-fx="rise"]        fade-in-up on enter, reverses when scrolled back out
 * - [data-fx-group]         children batch-staggered in (cards, grids)
 * - [data-fx="chars"]       headline words scrubbed from faint to solid with scroll
 * - [data-fx="title-chars"] hero headline split to characters that cascade in on load
 * - [data-fx="zoom"]        panel scrubbed from rounded/scaled-down to flat on enter
 * - [data-fx="drift"]       decorative objects drifting at data-fx-speed while scrolling
 * - [data-fx="count"]       numeric text counts up once when it enters the viewport
 * - [data-fx="marquee-scrub"] marquee nudged by scroll + CSS animation speeds up with velocity
 * - [data-fx-rotate]        element rotates by the given degrees as the page scrolls
 * - [data-fx-exit-x/-y]     Rayo hero scroll-out: element slides/stretches/fades as you leave
 * - [data-mouse-parallax]   hero decor follows the cursor at the given strength
 * - [data-magnetic]         buttons lean toward the cursor and spring back
 * - [data-fx-hero-intro]    one-time load-in stagger for hero copy rows
 *
 * All hidden states are applied from JS so the page stays fully readable when
 * JavaScript is unavailable, and everything is skipped for reduced motion.
 */
export function useHomeScrollFx(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const removers: Array<() => void> = [];

    const ctx = gsap.context(() => {
      // Hero load-in: stagger the copy rows once on mount.
      const heroIntroItems = gsap.utils.toArray<HTMLElement>("[data-fx-hero-intro]");
      let heroIntro: gsap.core.Tween | null = null;
      if (heroIntroItems.length > 0) {
        heroIntro = gsap.fromTo(
          heroIntroItems,
          { y: 44, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.9, ease: "power3.out", stagger: 0.12, delay: 0.1 },
        );
      }

      // Rayo `reveal-type` load-in variant: split the headline into characters
      // that cascade up with a slight tilt.
      gsap.utils.toArray<HTMLElement>('[data-fx="title-chars"]').forEach((el) => {
        const targets =
          el.querySelectorAll("em").length > 0
            ? Array.from(el.querySelectorAll<HTMLElement>("em"))
            : [el];
        const chars: HTMLElement[] = [];
        targets.forEach((target) => {
          const text = target.textContent ?? "";
          if (!text.trim()) return;
          target.setAttribute("aria-label", text);
          target.textContent = "";
          text.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) {
              target.appendChild(document.createTextNode(" "));
              return;
            }
            const word = document.createElement("span");
            word.className = "sm-fx-word";
            word.setAttribute("aria-hidden", "true");
            for (const letter of part) {
              const span = document.createElement("span");
              span.className = "sm-fx-char";
              span.textContent = letter;
              word.appendChild(span);
              chars.push(span);
            }
            target.appendChild(word);
          });
        });
        if (chars.length === 0) return;
        gsap.fromTo(
          chars,
          { yPercent: 120, rotate: 9, opacity: 0 },
          {
            yPercent: 0,
            rotate: 0,
            opacity: 1,
            duration: 1.05,
            ease: "power4.out",
            stagger: 0.028,
            delay: 0.18,
          },
        );
      });

      // Rayo hero-02/07 scroll-out: as the visitor scrolls away from the hero,
      // rows split apart sideways (or lift away), stretch, and fade. Created
      // after the intro finishes so the two tweens never fight over transforms.
      const heroRoot = document.querySelector<HTMLElement>("[data-fx-hero]");
      const createHeroExit = () => {
        if (!heroRoot) return;
        gsap.utils.toArray<HTMLElement>("[data-fx-exit-x], [data-fx-exit-y]").forEach((el) => {
          const exitX = Number(el.dataset.fxExitX ?? "0");
          const exitY = Number(el.dataset.fxExitY ?? "0");
          gsap.fromTo(
            el,
            { x: 0, y: 0, scaleY: 1, opacity: 1 },
            {
              x: exitX * 2.2,
              y: exitY * 2,
              scaleY: exitX !== 0 ? 1.18 : 1,
              opacity: 0,
              ease: "sine.in",
              transformOrigin: "50% 0%",
              scrollTrigger: {
                trigger: heroRoot,
                start: "top top",
                end: "+=560",
                scrub: true,
              },
            },
          );
        });
        ScrollTrigger.refresh();
      };
      if (heroIntro) {
        heroIntro.eventCallback("onComplete", createHeroExit);
      } else {
        createHeroExit();
      }

      // Rayo `anim-uni-in-up`: rise on enter, reverse on leave-back.
      gsap.utils.toArray<HTMLElement>('[data-fx="rise"]').forEach((el) => {
        gsap.fromTo(
          el,
          { y: 50, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.8,
            ease: "sine.out",
            scrollTrigger: {
              trigger: el,
              start: "top 88%",
              toggleActions: "play none none reverse",
            },
          },
        );
      });

      // Rayo `animate-card-N`: staggered card batches.
      gsap.utils.toArray<HTMLElement>("[data-fx-group]").forEach((group) => {
        const items = Array.from(group.children) as HTMLElement[];
        if (items.length === 0) return;
        gsap.set(items, { y: 50, opacity: 0 });
        ScrollTrigger.batch(items, {
          start: "top 90%",
          onEnter: (batch) =>
            gsap.to(batch, {
              y: 0,
              opacity: 1,
              duration: 0.7,
              ease: "sine.out",
              stagger: 0.15,
              overwrite: true,
            }),
          onEnterBack: (batch) =>
            gsap.to(batch, { y: 0, opacity: 1, stagger: 0.15, overwrite: true }),
          onLeaveBack: (batch) => gsap.set(batch, { y: 50, opacity: 0, overwrite: true }),
        });
      });

      // Rayo `reveal-type`: split into words, scrub opacity with scroll.
      gsap.utils.toArray<HTMLElement>('[data-fx="chars"]').forEach((el) => {
        const text = el.textContent ?? "";
        el.setAttribute("aria-label", text);
        el.textContent = "";
        const words = text.split(/\s+/).filter(Boolean);
        const spans = words.map((word, index) => {
          const span = document.createElement("span");
          span.textContent = index < words.length - 1 ? `${word} ` : word;
          span.style.display = "inline-block";
          span.setAttribute("aria-hidden", "true");
          el.appendChild(span);
          return span;
        });
        gsap.from(spans, {
          opacity: 0.16,
          scrollTrigger: { trigger: el, start: "top 85%", end: "top 30%", scrub: true },
          stagger: 0.08,
        });
      });

      // Rayo `anim-zoom-out-container`: slightly squeezed, relaxing to full size
      // on enter. Scale only: the stylesheet pins border-radius with !important,
      // so inline radius tweens would never win the cascade.
      gsap.utils.toArray<HTMLElement>('[data-fx="zoom"]').forEach((el) => {
        gsap.fromTo(
          el,
          { scale: 0.94, y: 24 },
          {
            scale: 1,
            y: 0,
            ease: "power2.out",
            transformOrigin: "center top",
            scrollTrigger: { trigger: el, start: "top 85%", end: "top 30%", scrub: true },
          },
        );
      });

      // Floating decor parallax: each object drifts at its own speed.
      gsap.utils.toArray<HTMLElement>('[data-fx="drift"]').forEach((el) => {
        const speed = Number(el.dataset.fxSpeed ?? "1");
        gsap.to(el, {
          y: -90 * speed,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
        });
      });

      // Rayo `animate-rotation`: spin by data-fx-rotate degrees with scroll.
      gsap.utils.toArray<HTMLElement>("[data-fx-rotate]").forEach((el) => {
        const degrees = Number(el.dataset.fxRotate ?? "180");
        gsap.fromTo(
          el,
          { rotation: 0 },
          {
            rotation: degrees,
            ease: "none",
            scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
          },
        );
      });

      // Word marquee: scroll nudges the band further left (margin-left, because
      // the CSS keyframe animation owns transform), and like Rayo's velocity
      // marquee, scroll speed temporarily accelerates the CSS animation.
      gsap.utils.toArray<HTMLElement>('[data-fx="marquee-scrub"]').forEach((el) => {
        gsap.fromTo(
          el,
          { marginLeft: 0 },
          {
            marginLeft: -120,
            ease: "none",
            scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
          },
        );

        const animations = typeof el.getAnimations === "function" ? el.getAnimations() : [];
        if (animations.length > 0) {
          const proxy = { rate: 1 };
          const apply = () => {
            animations.forEach((animation) => {
              animation.playbackRate = proxy.rate;
            });
          };
          let decay: gsap.core.Tween | null = null;
          ScrollTrigger.create({
            start: 0,
            end: "max",
            onUpdate: (self) => {
              decay?.kill();
              proxy.rate = gsap.utils.clamp(1, 4.5, 1 + Math.abs(self.getVelocity()) / 350);
              apply();
              decay = gsap.to(proxy, {
                rate: 1,
                duration: 1.2,
                ease: "power2.out",
                onUpdate: apply,
              });
            },
          });
        }
      });

      // Pointer-driven layers only make sense with a real cursor.
      if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        // Hero decor mouse parallax: objects lean away from the cursor.
        if (heroRoot) {
          const layers = gsap.utils.toArray<HTMLElement>("[data-mouse-parallax]").map((el) => ({
            strength: Number(el.dataset.mouseParallax ?? "20"),
            xTo: gsap.quickTo(el, "xPercent", { duration: 0.6, ease: "power3.out" }),
            yTo: gsap.quickTo(el, "yPercent", { duration: 0.6, ease: "power3.out" }),
          }));
          if (layers.length > 0) {
            const onMove = (event: MouseEvent) => {
              const nx = (event.clientX / window.innerWidth) * 2 - 1;
              const ny = (event.clientY / window.innerHeight) * 2 - 1;
              layers.forEach((layer) => {
                layer.xTo(nx * layer.strength);
                layer.yTo(ny * layer.strength * 0.6);
              });
            };
            window.addEventListener("mousemove", onMove, { passive: true });
            removers.push(() => window.removeEventListener("mousemove", onMove));
          }
        }

        // Magnetic CTAs: buttons lean toward the cursor, spring back on leave.
        gsap.utils.toArray<HTMLElement>("[data-magnetic]").forEach((el) => {
          const xTo = gsap.quickTo(el, "x", { duration: 0.4, ease: "power3.out" });
          const yTo = gsap.quickTo(el, "y", { duration: 0.4, ease: "power3.out" });
          const onMove = (event: MouseEvent) => {
            const rect = el.getBoundingClientRect();
            const relX = event.clientX - (rect.left + rect.width / 2);
            const relY = event.clientY - (rect.top + rect.height / 2);
            xTo(gsap.utils.clamp(-14, 14, relX * 0.3));
            yTo(gsap.utils.clamp(-10, 10, relY * 0.4));
          };
          const onLeave = () => {
            gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1, 0.4)" });
          };
          el.addEventListener("mousemove", onMove, { passive: true });
          el.addEventListener("mouseleave", onLeave);
          removers.push(() => {
            el.removeEventListener("mousemove", onMove);
            el.removeEventListener("mouseleave", onLeave);
          });
        });
      }
    });

    return () => {
      removers.forEach((remove) => remove());
      ctx.revert();
    };
  }, [enabled]);
}

/**
 * Count-up for [data-fx="count"] values inside `ref`. Runs once `ready` flips
 * true (metrics arrive after the initial fetch), so it is separate from the
 * mount-once scroll layer above.
 */
export function useHomeCountUp(ref: RefObject<HTMLElement | null>, ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const root = ref.current;
    if (!root || typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const originals = new Map<HTMLElement, string>();
    const ctx = gsap.context(() => {
      root.querySelectorAll<HTMLElement>('[data-fx="count"]').forEach((el) => {
        const raw = el.textContent ?? "";
        const match = raw.match(/^([^0-9]*)([0-9][0-9.,]*)(.*)$/);
        if (!match) return;
        const [, prefix, numberText, suffix] = match;
        const target = Number(numberText.replace(/,/g, ""));
        if (!Number.isFinite(target)) return;
        originals.set(el, raw);
        const decimals = numberText.includes(".") ? (numberText.split(".")[1]?.length ?? 0) : 0;
        const counter = { value: 0 };
        gsap.to(counter, {
          value: target,
          duration: 1.6,
          ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 92%" },
          onUpdate: () => {
            el.textContent = `${prefix}${counter.value.toLocaleString("en-US", {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            })}${suffix}`;
          },
          onComplete: () => {
            el.textContent = raw;
          },
        });
      });
    }, root);

    return () => {
      ctx.revert();
      originals.forEach((raw, el) => {
        el.textContent = raw;
      });
    };
  }, [ref, ready]);
}

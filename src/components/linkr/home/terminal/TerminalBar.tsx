import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Terminal, X } from "lucide-react";
import { xIntent } from "@/lib/linkr/home-data";

const TABS = [
  { href: "#launches", label: "Live" },
  { href: "#posts", label: "Q&A" },
  { href: "#launches", label: "Explore" },
  { href: "#posts", label: "Questions" },
  { href: "#receipts", label: "Receipts" },
  { href: "#wallets", label: "Wallets" },
  { href: "#system", label: "System" },
] as const;

const CHIPS = ["help", "track", "buy", "receipts", "wallets"] as const;

export function TerminalBar({ mobileMenuOpen = false }: { mobileMenuOpen?: boolean }) {
  const [command, setCommand] = useState("");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!terminalOpen) return;
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 360);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTerminalOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [terminalOpen]);

  useEffect(() => {
    if (mobileMenuOpen) setTerminalOpen(false);
  }, [mobileMenuOpen]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = command.trim();
    window.open(xIntent(`@linkrcash ${text || "help"}`), "_blank", "noopener");
    setTerminalOpen(false);
  };

  return (
    <>
      <button
        className="lkt-terminal-launcher"
        type="button"
        aria-label="Open Linkr terminal"
        aria-controls="terminal"
        aria-expanded={terminalOpen}
        aria-hidden={mobileMenuOpen}
        data-mobile-menu-open={mobileMenuOpen}
        tabIndex={mobileMenuOpen ? -1 : 0}
        onClick={() => setTerminalOpen(true)}
      >
        <span className="lkt-terminal-launcher-rings" aria-hidden="true" />
        <Terminal aria-hidden="true" size={25} strokeWidth={2.5} />
      </button>

      <section
        className="lkt-panel lkt-terminal"
        id="terminal"
        aria-label="Linkr terminal"
        data-open={terminalOpen}
      >
        <button
          className="lkt-terminal-mobile-close"
          type="button"
          aria-label="Close Linkr terminal"
          onClick={() => setTerminalOpen(false)}
        >
          <X aria-hidden="true" size={19} strokeWidth={2.6} />
        </button>
        <div className="lkt-terminal-top">
          <span className="lkt-terminal-title">
            <span aria-hidden="true">&gt;</span> Linkr Terminal
          </span>
          <nav className="lkt-terminal-tabs" aria-label="Terminal sections">
            {TABS.map((tab, index) => (
              <a
                key={tab.label}
                href={tab.href}
                data-active={index === 0}
                onClick={() => setTerminalOpen(false)}
              >
                {index === 0 && <span className="lkt-dot" aria-hidden="true" />}
                {tab.label}
              </a>
            ))}
          </nav>
          <span className="lkt-terminal-health" data-ok="true">
            <span className="lkt-dot" aria-hidden="true" />
            Online
          </span>
        </div>

        <form className="lkt-terminal-form" onSubmit={submit}>
          <span className="lkt-terminal-prompt" aria-hidden="true">
            &gt;
          </span>
          <input
            ref={inputRef}
            className="lkt-terminal-input"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="Type a command or ask Linkr anything..."
            aria-label="Linkr command"
          />
          <div className="lkt-terminal-chips">
            {CHIPS.map((chip) => (
              <button key={chip} type="button" onClick={() => setCommand(chip)}>
                {chip}
              </button>
            ))}
          </div>
          <button className="lkt-terminal-send" type="submit" aria-label="Send command on X">
            <ArrowRight aria-hidden="true" size={17} strokeWidth={2.6} />
          </button>
        </form>
      </section>
    </>
  );
}

import { Link, createFileRoute } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/linkr/MarketingHeader";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy - Linkr" },
      {
        name: "description",
        content: "Privacy information for Linkr account connection and web dashboard services.",
      },
    ],
  }),
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
  const sections = [
    {
      title: "Overview",
      text: "Linkr provides custodial wallet, transaction, automation, social-account, Telegram, and developer API features. This policy describes the information Linkr handles to provide and secure those services. Public blockchain activity remains publicly visible and may be copied or indexed by third parties independently of Linkr.",
    },
    {
      title: "Information we handle",
      text: "We may handle account and profile details; X and Telegram identifiers; wallet addresses; encrypted wallet private-key material; raw private-key material transiently during wallet import, signing, or an export you request; API credential hashes and metadata; transaction, launch, schedule, terminal, and agent activity; security and audit events; support communications; IP address, user agent, device or browser information; cookie preferences; and information you submit through the service.",
    },
    {
      title: "How we use information",
      text: "We use information to authenticate users, provision and operate wallets, sign and submit authorized transactions, execute configured automations, connect X and Telegram, provide API and dashboard features, prevent abuse, investigate incidents, maintain audit records, troubleshoot failures, improve reliability, comply with law, and communicate important service information.",
    },
    {
      title: "Wallet keys and security-sensitive information",
      text: "Supported wallet private keys are encrypted for storage but may be decrypted within Linkr's backend to sign an authorized action. If you import a wallet, the supplied key is transmitted to Linkr for validation and encrypted storage. If you export a wallet, the raw key is returned to your browser and may be revealed, copied, or downloaded at your direction. No storage or security system can be guaranteed immune from compromise, and an exported key may be captured by software or people with access to your device.",
    },
    {
      title: "Connected platforms and service providers",
      text: "To provide requested features, Linkr may exchange information with X, Telegram, Supabase, Vercel, blockchain networks, RPC providers, block explorers, market-data and routing providers, token and liquidity protocols, storage or media providers, and other infrastructure used by the service. Those providers process information under their own terms and privacy practices. You can change connected-account permissions through Linkr or the relevant platform when controls are available.",
    },
    {
      title: "Sharing and public blockchain data",
      text: "We do not sell personal information. We may disclose information to service providers that operate the service; to connected platforms when you request an integration; to professional advisers; to authorities or other parties when required by law or reasonably necessary to protect users, rights, safety, or the service; or as part of a corporate transaction. Wallet addresses and transactions submitted to a public blockchain are public and cannot be made private or deleted by Linkr.",
    },
    {
      title: "Browser storage and preferences",
      text: "Linkr uses browser storage and similar technologies for essential authentication sessions, security state, product preferences, popup coordination, and service reliability. Where optional analytics or preference controls are offered, your selection is stored in your browser. Clearing browser data may sign you out or reset preferences. Authentication information stored by the browser may be accessible to scripts running on the Linkr origin, which is why device and browser security are important.",
    },
    {
      title: "Security and retention",
      text: "We use administrative, technical, and organizational safeguards designed to reduce unauthorized access, including encryption of stored wallet keys, access controls, additional verification for key export, rate limits, and security logging. These measures reduce but do not eliminate risk. We retain information for as long as reasonably needed to provide the service, secure accounts, reconcile transactions, resolve disputes, enforce agreements, and satisfy legal or audit obligations. Retention periods differ by record type, and immutable public blockchain records are outside Linkr's control.",
    },
    {
      title: "Your choices",
      text: "You may be able to review or update profile settings, disconnect supported integrations, revoke API credentials, cancel schedules, export supported wallet keys, and sign out through product controls. You may contact Linkr about access, correction, or deletion requests. Some records may need to be retained for security, transaction reconciliation, legal compliance, or legitimate operational purposes, and Linkr cannot alter public blockchain records or data controlled by another platform.",
    },
    {
      title: "Children and international use",
      text: "Linkr is not intended for children or for anyone who cannot legally agree to the Terms of Service. Information may be processed in countries other than the one where you live, subject to the safeguards and legal requirements applicable to Linkr and its providers.",
    },
    {
      title: "Contact",
      text: "Questions, privacy requests, or security concerns can be submitted through Linkr's official support or contact channels. Do not send a private key, seed phrase, password, session token, or API credential in a support message.",
    },
  ];

  return (
    <div className="sm-legal-page">
      <MarketingHeader />
      <main className="sm-legal-shell">
        <section className="sm-legal-hero" aria-labelledby="privacy-title">
          <div className="sm-legal-hero-copy">
            <h1 id="privacy-title">
              Privacy <span>Policy</span>
            </h1>
            <p className="sm-legal-lede">
              How Linkr handles account details, connected services, activity records, and the data
              needed to keep the product working.
            </p>
          </div>

          <aside className="sm-legal-meta" aria-label="Privacy summary">
            <div>
              <span>Updated</span>
              <strong>July 22, 2026</strong>
            </div>
            <div>
              <span>Applies to</span>
              <strong>Linkr web and connected services</strong>
            </div>
            <Link to="/terms-of-service">Terms of Service</Link>
          </aside>
        </section>

        <section className="sm-legal-content" aria-label="Privacy Policy details">
          <aside className="sm-legal-summary">
            <span>Read first</span>
            <p>
              Linkr uses information to run the product, support connected accounts, improve
              reliability, and protect the service. We do not sell personal information.
            </p>
          </aside>

          <div className="sm-legal-sections">
            {sections.map((section, index) => (
              <article className="sm-legal-card" key={section.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h2>{section.title}</h2>
                  <p>{section.text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="sm-rayo-footer sm-legal-footer" aria-label="Footer">
        <div>linkr</div>
        <p>Reply on X. Check the rules. Sign only what should move.</p>
        <nav className="sm-legal-footer-links" aria-label="Legal">
          <Link to="/terms-of-service">Terms</Link>
          <Link to="/docs">Docs</Link>
          <Link to="/">Home</Link>
        </nav>
      </footer>
    </div>
  );
}

import { Link, createFileRoute } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/linkr/MarketingHeader";

export const Route = createFileRoute("/terms-of-service")({
  head: () => ({
    meta: [
      { title: "Terms of Service - Linkr" },
      {
        name: "description",
        content: "Terms for using Linkr's web interface and on-chain protocol tools.",
      },
    ],
  }),
  component: TermsOfServicePage,
});

function TermsOfServicePage() {
  const shortVersion =
    "Linkr provides custodial wallet and automation tools that can create, import, store in encrypted form, and use private keys to carry out actions you authorize through the web app, X, Telegram, SMS/MMS, scheduled actions, or API credentials. You can export a raw private key, but anyone who obtains it can control that wallet. Digital assets and automated transactions carry serious risk, including total loss. Use Linkr only if you understand these risks and your use is lawful where you are.";

  const sections = [
    {
      title: "Acceptance of these Terms",
      paragraphs: [
        'These Terms of Service ("Terms") govern your access to and use of the Linkr website, application, tools, and related user interface (the "Interface"). By accessing the Interface, connecting a wallet, or using the Interface to interact with any on-chain protocol, you agree to these Terms.',
        "If you do not understand or agree to these Terms, do not use the Interface.",
      ],
    },
    {
      title: "The Interface and the Protocol",
      paragraphs: [
        'The Interface is one of many ways to interact with permissionless smart contracts deployed on public blockchains (the "Protocol"). The Protocol is decentralized and can be called directly on-chain, through other independently built interfaces, or through developer tooling without using Linkr.',
        "Tokens launched through the Protocol are created by users through on-chain contracts. Liquidity and trading may occur through permissionless automated market maker protocols, including protocols such as Uniswap v3, that operate independently on-chain. These systems can continue to function even if the Interface is unavailable.",
        "Linkr does not own, control, or operate the underlying blockchains, wallet software, automated market maker protocols, token contracts, or deployed liquidity pools. We cannot reverse, modify, speed up, cancel, or guarantee any transaction, and we cannot alter deployed contracts.",
        "Smart contracts and blockchain systems are experimental. They may contain unknown vulnerabilities, fail unexpectedly, reorganize, fork, become congested, or interact unpredictably with wallets, indexers, infrastructure, or third-party tools.",
      ],
    },
    {
      title: "Eligibility and restricted jurisdictions",
      paragraphs: [
        "You may use the Interface only if you are legally permitted to do so, are old enough to form a binding agreement in your jurisdiction, and are not barred from using the Interface under applicable law.",
        "You may not use the Interface if you are located in, organized in, ordinarily resident in, or otherwise subject to the laws of a jurisdiction where your use would be prohibited. You also may not use the Interface if you are subject to sanctions, export controls, or appear on any list of restricted or prohibited parties.",
        "You are solely responsible for determining whether your use of the Interface is lawful and for complying with all laws, rules, regulations, and tax obligations that apply to you.",
      ],
    },
    {
      title: "Custodial wallets, automation, and key export",
      paragraphs: [
        "Linkr provides custodial wallet functionality. When Linkr creates or imports a supported wallet, its private key is encrypted for storage and may be decrypted by Linkr's backend when needed to sign an action that you request or have previously authorized. Linkr's current wallet encryption design uses server-controlled cryptographic material, so a compromise of Linkr's privileged systems or secrets could put wallets at risk.",
        "Depending on the feature you use, an action may be requested through the web dashboard, X, Telegram, SMS/MMS, a schedule, or an API credential. SMS requests and confirmations are accepted only from a linked phone and carrier delivery is not guaranteed. Value-moving SMS actions require the exact confirmation phrase Linkr provides. Some actions may execute automatically within the limits and confirmation rules configured for your account. You are responsible for reviewing those rules, protecting connected accounts, phones, and API credentials, and promptly disabling automation you no longer want. Reply STOP to opt out of Linkr texts and START to opt back in.",
        "Linkr allows you to reveal, copy, or download a raw private key for a supported wallet after additional verification. A raw private key gives complete control of that wallet. Browser extensions, malware, screenshots, clipboard managers, downloaded files, backups, or anyone with access to your device may capture it. Linkr cannot prevent use of a key after export and cannot reverse transactions made with it.",
        "Blockchain transactions are generally final. Linkr cannot recover assets sent to the wrong address, reverse an executed trade, restore an exported key that is lost, or guarantee recovery after an account, device, connected service, API credential, or private key is compromised.",
      ],
    },
    {
      title: "User-created tokens; no endorsement",
      paragraphs: [
        "Tokens visible through the Interface are created permissionlessly by third parties, not by Linkr. A token's appearance in the Interface, search results, charts, feeds, lists, or transaction flows does not mean Linkr endorses, verifies, sponsors, recommends, or has reviewed that token.",
        "Token names, symbols, images, links, descriptions, supply details, and other metadata may be inaccurate, misleading, offensive, infringing, impersonating, or fraudulent. Anyone may create a token, including tokens designed to mislead buyers or become worthless.",
        "You are solely responsible for evaluating any token, creator, contract address, pool, transaction, or market before interacting with it.",
      ],
    },
    {
      title: "Assumption of risk",
      paragraphs: [
        "By using the Interface, you accept the risks of digital assets and blockchain transactions. These risks include total loss of funds, extreme price volatility, low or disappearing liquidity, smart contract bugs, malicious tokens, exploits, failed transactions, wallet compromise, mistaken approvals, front-running, MEV, chain congestion, forks, reorganizations, inaccurate data, and regulatory uncertainty.",
        "Digital assets are not legal tender, are not backed by any government, and may not be protected by deposit insurance, investor protection programs, chargeback rights, or similar safeguards.",
        "Never use funds you cannot afford to lose entirely.",
      ],
    },
    {
      title: "No financial, legal, tax, or investment advice",
      paragraphs: [
        "The Interface is provided for informational and transactional access only. Nothing on or through the Interface is financial, investment, trading, legal, accounting, or tax advice.",
        "Linkr is not your broker, dealer, investment adviser, legal adviser, tax adviser, fiduciary, or agent. No information displayed by the Interface, and no communication from Linkr, should be treated as a recommendation, solicitation, offer, guarantee, or promise about any asset, token, transaction, strategy, or outcome.",
      ],
    },
    {
      title: "Market data and Interface availability",
      paragraphs: [
        "Prices, charts, market capitalization, volume, holder counts, activity, token metadata, balances, and other information may be derived from indexers, public blockchain data, and third-party infrastructure. This information is provided as-is and may be delayed, incomplete, inaccurate, stale, or unavailable.",
        "The on-chain state is the source of truth. You should independently verify contract addresses, transaction details, fees, token information, and market conditions before taking action.",
        "We may update, limit, suspend, remove, or discontinue any part of the Interface at any time without notice. We do not guarantee that the Interface will be available, uninterrupted, accurate, secure, or error-free.",
      ],
    },
    {
      title: "Fees and transaction costs",
      paragraphs: [
        "The Protocol or related on-chain systems may apply fees to certain actions, including token launches, swaps, or other transactions, according to parameters recorded on-chain.",
        "Blockchain networks also charge gas or transaction fees that Linkr does not control and may not receive. Fees can change quickly and may be charged even when a transaction fails. Where practical, the Interface may display fee information before you confirm a transaction, but on-chain data and your wallet confirmation are controlling.",
      ],
    },
    {
      title: "Account security and authorization",
      paragraphs: [
        "You are responsible for securing your Linkr session, X and Telegram accounts, linked phone number and text-message access, email or device access, API credentials, exported private keys, and any device used with the Interface. You must notify Linkr promptly if you suspect unauthorized access and use available controls to revoke sessions, credentials, schedules, or connected accounts.",
        "A request that is authenticated through your account, connected service, or API credential may be treated as authorized by you, subject to Linkr's security checks and configured limits. Additional verification reduces risk but cannot eliminate phishing, malware, social-account compromise, or device compromise.",
      ],
    },
    {
      title: "Prohibited uses",
      paragraphs: [
        "You agree not to use the Interface to violate any law, regulation, sanction, or third-party right; facilitate fraud, market manipulation, money laundering, terrorist financing, or other unlawful activity; create or promote deceptive, infringing, or malicious tokens; interfere with the Interface or its infrastructure; attempt unauthorized access; scrape or overload systems in a harmful way; or introduce malware or harmful code.",
        "We may restrict, block, or limit access to the Interface when we believe it is necessary to comply with law, protect users, protect infrastructure, respond to abuse, or enforce these Terms.",
      ],
    },
    {
      title: "Taxes",
      paragraphs: [
        "You are solely responsible for determining whether taxes apply to your transactions, for keeping appropriate records, and for reporting and paying any taxes, duties, or assessments owed to the relevant authorities.",
      ],
    },
    {
      title: "Third-party services and links",
      paragraphs: [
        "The Interface may display, rely on, or link to third-party services, including wallets, block explorers, charting tools, indexers, infrastructure providers, social platforms, automated market maker protocols, and public blockchain networks.",
        "Linkr does not control third-party services and is not responsible for their content, availability, security, accuracy, policies, or actions. Your use of third-party services is at your own risk and may be governed by separate terms.",
      ],
    },
    {
      title: "Third-party names and no affiliation",
      paragraphs: [
        "Linkr is an independent interface. Unless expressly stated by Linkr, it is not affiliated with, endorsed by, sponsored by, or operated by any blockchain network, exchange, wallet provider, explorer, infrastructure provider, token issuer, or other third party referenced by the Interface.",
        'References to third-party names, including names such as "Robinhood Chain," identify third-party networks, products, services, or ecosystems. Third-party names, trademarks, logos, and brands remain the property of their respective owners.',
      ],
    },
    {
      title: "Intellectual property",
      paragraphs: [
        "The Linkr name, logo, visual design, software, content, and Interface elements are owned by Linkr or its licensors, except for third-party materials and user-provided content. These Terms grant you a limited, revocable, non-exclusive, non-transferable license to use the Interface for its intended purpose and in compliance with these Terms.",
        "Token creators and other users are responsible for any names, images, descriptions, links, or metadata they submit or cause to appear on-chain or through the Interface.",
      ],
    },
    {
      title: "Disclaimer of warranties",
      paragraphs: [
        'THE INTERFACE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY. TO THE FULLEST EXTENT PERMITTED BY LAW, LINKR DISCLAIMS ALL WARRANTIES, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, SECURITY, ACCURACY, AVAILABILITY, AND RELIABILITY.',
        "LINKR DOES NOT WARRANT THAT THE INTERFACE, PROTOCOL ACCESS, DATA, CONTENT, OR THIRD-PARTY SERVICES WILL BE UNINTERRUPTED, SECURE, ERROR-FREE, ACCURATE, COMPLETE, OR FREE FROM HARMFUL COMPONENTS.",
      ],
    },
    {
      title: "Limitation of liability",
      paragraphs: [
        "TO THE FULLEST EXTENT PERMITTED BY LAW, LINKR, ITS CONTRIBUTORS, AFFILIATES, SERVICE PROVIDERS, AND LICENSORS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, PUNITIVE, OR SIMILAR DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, GOODWILL, DATA, DIGITAL ASSETS, TOKENS, PRIVATE KEYS, OR BUSINESS OPPORTUNITY, ARISING FROM OR RELATED TO YOUR USE OF, OR INABILITY TO USE, THE INTERFACE OR ANY ON-CHAIN PROTOCOL.",
        "TO THE FULLEST EXTENT PERMITTED BY LAW, LINKR'S TOTAL LIABILITY FOR ALL CLAIMS ARISING FROM OR RELATED TO THE INTERFACE OR THESE TERMS WILL NOT EXCEED ONE HUNDRED U.S. DOLLARS (USD 100).",
      ],
    },
    {
      title: "Indemnification",
      paragraphs: [
        "You agree to defend, indemnify, and hold harmless Linkr, its contributors, affiliates, service providers, and licensors from and against any claims, damages, losses, liabilities, costs, and expenses, including reasonable legal fees, arising from or related to your use of the Interface, your transactions, your tokens or content, your violation of these Terms, your violation of law, or your violation of any third-party rights.",
      ],
    },
    {
      title: "Changes to these Terms",
      paragraphs: [
        "We may update these Terms from time to time by posting a revised version on this page and updating the effective date or version information. If we require acceptance of updated Terms, you must accept them before continuing to use the Interface.",
        "Your continued use of the Interface after updated Terms become effective means you accept the updated Terms.",
      ],
    },
    {
      title: "Severability",
      paragraphs: [
        "If any provision of these Terms is found to be invalid or unenforceable, that provision will be enforced to the maximum extent permitted, and the remaining provisions will remain in full force and effect.",
      ],
    },
    {
      title: "Contact",
      paragraphs: [
        "Questions about these Terms may be raised through Linkr's official support or community channels.",
      ],
    },
  ];

  return (
    <div className="sm-legal-page">
      <MarketingHeader />
      <main className="sm-legal-shell">
        <section className="sm-legal-hero" aria-labelledby="terms-title">
          <div className="sm-legal-hero-copy">
            <h1 id="terms-title">
              Terms of <span>Service</span>
            </h1>
            <p className="sm-legal-lede">
              The rules for using Linkr's Interface, connecting your wallet, and interacting with
              permissionless on-chain systems.
            </p>
          </div>

          <aside className="sm-legal-meta" aria-label="Terms summary">
            <div>
              <span>Updated</span>
              <strong>July 12, 2026</strong>
            </div>
            <div>
              <span>Version</span>
              <strong>1.0</strong>
            </div>
            <Link to="/privacy-policy">Privacy Policy</Link>
          </aside>
        </section>

        <section className="sm-legal-short" aria-labelledby="terms-short-title">
          <span>Read first</span>
          <h2 id="terms-short-title">The short version</h2>
          <p>{shortVersion}</p>
        </section>

        <section className="sm-legal-content" aria-label="Terms of Service details">
          <aside className="sm-legal-summary">
            <span>Core principle</span>
            <p>
              Linkr can sign authorized actions. The chain executes them. Protect every account and
              key that can authorize your wallet.
            </p>
          </aside>

          <div className="sm-legal-sections">
            {sections.map((section, index) => (
              <article className="sm-legal-card" key={section.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h2>{section.title}</h2>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
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
          <Link to="/privacy-policy">Privacy</Link>
          <Link to="/docs">Docs</Link>
          <Link to="/">Home</Link>
        </nav>
      </footer>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/* -------------------------------------------------------------------------- */
/*  Content                                                                    */
/* -------------------------------------------------------------------------- */

const NAV_LINKS = [
  { label: "Features", target: "features" },
  { label: "Workflow", target: "workflow" },
  { label: "Pricing", target: "pricing" },
  { label: "FAQ", target: "faq" },
];

const STATS = [
  { value: "8+", label: "Specialized AI agents" },
  { value: "11", label: "Indian languages" },
  { value: "5+", label: "Guardrail layers" },
  { value: "60%", label: "Less research time" },
];

const TRUST = [
  "Corporate Law Firms",
  "Litigation Chambers",
  "Legal Aid Agencies",
  "In-House Counsel",
  "Solo Advocates",
  "Compliance Teams",
];

const FEATURES = [
  {
    icon: "📄",
    title: "Document Intelligence",
    desc: "Upload FIRs, contracts, judgments, notices, and court orders for instant, source-backed legal analysis with OCR.",
  },
  {
    icon: "⚖️",
    title: "Indian Legal Research",
    desc: "Search case law, constitutional provisions, statutory sections, and court precedents — with verifiable citations.",
  },
  {
    icon: "🛡️",
    title: "Guardrailed by Design",
    desc: "PII masking, unsafe-advice blocking, hallucination checks, citation validation, and confidence scoring built in.",
  },
  {
    icon: "🌍",
    title: "Multilingual Support",
    desc: "Ask in English, Hindi, Urdu, Punjabi, Tamil, Telugu, Bengali, Marathi, Gujarati, Kannada, or Malayalam.",
  },
  {
    icon: "🔎",
    title: "OCR + RAG Pipeline",
    desc: "Extract, chunk, embed, retrieve, and reason over your documents with precise semantic search.",
  },
  {
    icon: "✍️",
    title: "Drafting & Redlining",
    desc: "Generate and compare agreements, notices, and petitions that mirror your firm's own templates.",
  },
];

const BENEFITS = [
  {
    stat: "60%",
    title: "Faster legal research",
    desc: "Cut hours of manual precedent-hunting into seconds with retrieval that cites its sources.",
  },
  {
    stat: "100%",
    title: "Source-backed answers",
    desc: "Every response is grounded in your documents and trusted legal databases — no black-box guesses.",
  },
  {
    stat: "24/7",
    title: "Always-on associate",
    desc: "A tireless legal assistant for your firm, agency, or chambers — available in every language your clients speak.",
  },
];

const WORKFLOW = [
  {
    step: "01",
    title: "Ask or Upload",
    desc: "Pose a legal question or upload an FIR, judgment, contract, court order, notice, or petition.",
  },
  {
    step: "02",
    title: "Retrieve Verified Context",
    desc: "Legal AI searches your documents, legal APIs, court sources, and trusted databases in parallel.",
  },
  {
    step: "03",
    title: "Generate Cited Answer",
    desc: "The response is structured with citations, confidence checks, hallucination filtering, and a legal disclaimer.",
  },
];

const AGENTS: [string, string][] = [
  ["Intent Agent", "Detects whether the user needs research, document analysis, drafting, translation, or explanation."],
  ["Router Agent", "Controls the multi-agent workflow and decides the best retrieval path."],
  ["Document Agent", "Processes PDFs using OCR, chunking, embeddings, and vector search."],
  ["API Agent", "Retrieves structured information from legal APIs, court databases, and statutes."],
  ["Web Agent", "Fetches recent legal updates, public legal sources, and government notifications."],
  ["Guardrail Agent", "Applies safety, citation validation, PII filtering, and unsafe-advice blocking."],
  ["Translation Agent", "Handles regional-language queries and replies in the user's language."],
  ["Final Answer Agent", "Combines verified context into a single, structured legal response."],
];

const PIPELINE: [string, string][] = [
  ["User Question", "text-[#f0e6cc]"],
  ["Language Detection", "text-[#9ec9ff]"],
  ["Intent Understanding", "text-[#a7e8bd]"],
  ["Legal Retrieval Layer", "text-[#d3b3f0]"],
  ["RAG Context Collection", "text-[#f0d58a]"],
  ["LLM Legal Reasoning", "text-[#8fe3e3]"],
  ["Citation + Hallucination Check", "text-[#f0a898]"],
  ["Final Legal Answer", "text-[#c9a96e]"],
];

const PRICING = [
  {
    name: "Starter",
    price: "₹1,499",
    period: "/mo",
    target: "Students · Citizens · Solo advocates",
    features: [
      "Basic legal Q&A",
      "PDF document analysis",
      "Multilingual responses",
      "Source-backed answers",
      "Legal disclaimer included",
    ],
    cta: "Get Started",
    highlight: false,
  },
  {
    name: "Professional",
    price: "₹5,999",
    period: "/mo",
    target: "Small law firms · Advocates",
    features: [
      "Higher query limits",
      "Advanced document intelligence",
      "API + web legal retrieval",
      "Citation-aware responses",
      "Conversation memory",
      "Priority support",
    ],
    cta: "Start Free Trial",
    highlight: true,
  },
  {
    name: "Business",
    price: "₹14,999",
    period: "/mo",
    target: "Mid-size firms · Legal teams",
    features: [
      "Team usage & seats",
      "Bulk document analysis",
      "Advanced guardrails",
      "Confidence scoring",
      "Billing & usage tracking",
      "Longer history retention",
    ],
    cta: "Get Started",
    highlight: false,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    target: "Corporates · Large firms",
    features: [
      "Custom deployment",
      "SSO & RBAC",
      "Audit logs",
      "Custom legal sources",
      "Dedicated support",
      "Enterprise integrations",
    ],
    cta: "Book a Demo",
    highlight: false,
  },
];

const TESTIMONIALS = [
  {
    quote:
      "Legal AI cut our first-pass contract review from a full afternoon to under ten minutes. The citations mean I actually trust what it surfaces.",
    name: "Ananya Rao",
    role: "Senior Partner, Corporate Practice",
    initials: "AR",
  },
  {
    quote:
      "The multilingual support is a game-changer for legal aid. Clients ask in Marathi or Tamil and get grounded, source-backed guidance instantly.",
    name: "Imran Sheikh",
    role: "Director, Legal Aid Agency",
    initials: "IS",
  },
  {
    quote:
      "Guardrails and confidence scoring were what sold us. It refuses to bluff, flags uncertainty, and always points back to the source document.",
    name: "Priya Nair",
    role: "General Counsel, Fintech",
    initials: "PN",
  },
  {
    quote:
      "Drafting that mirrors our own templates saves my juniors hours every week. It feels like an associate who already knows our house style.",
    name: "Vikram Desai",
    role: "Managing Advocate, Litigation Chambers",
    initials: "VD",
  },
];

const FAQS = [
  {
    q: "What exactly does the AI Legal Agent do?",
    a: "It reads your legal documents, researches Indian case law and statutes, drafts and redlines agreements, and answers legal questions in 11 languages — every answer grounded in verifiable sources with a legal disclaimer.",
  },
  {
    q: "Is it a replacement for a lawyer?",
    a: "No. Legal AI provides AI-assisted legal information and speeds up research and drafting. It is not a substitute for professional legal advice, and important decisions should always be confirmed with a qualified advocate.",
  },
  {
    q: "How does it keep answers accurate and safe?",
    a: "A dedicated Guardrail Agent applies PII masking, unsafe-advice blocking, hallucination checks, citation validation, and confidence scoring before any answer reaches you. If it isn't sure, it tells you.",
  },
  {
    q: "Can it work with my firm's own documents?",
    a: "Yes. Upload FIRs, contracts, judgments, notices, and court orders. The OCR + RAG pipeline extracts, embeds, and reasons over them so answers reflect your actual case files — and drafts mirror your own templates.",
  },
  {
    q: "Which languages are supported?",
    a: "English, Hindi, Urdu, Punjabi, Tamil, Telugu, Bengali, Marathi, Gujarati, Kannada, and Malayalam — ask in any of them and get a reply in the same language.",
  },
  {
    q: "Is my data secure?",
    a: "Data is processed with PII masking and access controls, and Enterprise plans add SSO, RBAC, and audit logs. Your documents are used to answer your questions — not shared across firms.",
  },
];

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function LandingPage() {
  useScrollReveal();

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div
      className="min-h-screen bg-[#0b0906] text-[#e0d2ba] antialiased selection:bg-[#c9a96e]/30"
      style={{ fontFamily: "var(--font-geist-sans, Arial, sans-serif)" }}
    >
      <Nav scrollTo={scrollTo} />
      <Hero scrollTo={scrollTo} />
      <TrustBar />
      <Benefits />
      <Features />
      <Workflow />
      <AgenticSystem />
      <Pricing />
      <Testimonials />
      <Faq />
      <FinalCta />
      <Footer />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Navigation                                                                 */
/* -------------------------------------------------------------------------- */

function Nav({ scrollTo }: { scrollTo: (id: string) => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`sticky top-0 z-50 border-b transition-all duration-300 ${
        scrolled
          ? "border-[#c9a96e]/15 bg-[#0b0906]/85 backdrop-blur-xl"
          : "border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="group flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#c9a96e]/30 bg-[#c9a96e]/10 shadow-lg shadow-[#c9a96e]/10 transition group-hover:border-[#c9a96e]/50">
            <span className="text-xl">⚖️</span>
          </div>
          <div className="leading-tight">
            <p className="text-lg font-black tracking-tight text-[#f0e6cc]">
              Legal <span className="text-[#c9a96e]">AI</span>
            </p>
            <p className="text-[11px] text-[#8a7c68]">Legal Intelligence Platform</p>
          </div>
        </Link>

        <div className="hidden items-center gap-8 text-sm text-[#8a7c68] md:flex">
          {NAV_LINKS.map((link) => (
            <button
              key={link.target}
              onClick={() => scrollTo(link.target)}
              className="transition hover:text-[#f0e6cc]"
            >
              {link.label}
            </button>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/login"
            className="rounded-xl px-4 py-2 text-sm font-semibold text-[#e0d2ba] transition hover:text-[#f0e6cc]"
          >
            Login
          </Link>
          <Link
            href="/login"
            className="rounded-xl bg-[#c9a96e] px-5 py-2.5 text-sm font-bold text-[#1a0e00] shadow-lg shadow-[#c9a96e]/20 transition hover:-translate-y-0.5 hover:bg-[#d9bd86] hover:shadow-[#c9a96e]/40"
          >
            Get Started
          </Link>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#c9a96e]/20 text-[#f0e6cc] md:hidden"
          aria-label="Toggle menu"
        >
          <span className="text-lg">{open ? "✕" : "☰"}</span>
        </button>
      </div>

      {open && (
        <div className="border-t border-[#c9a96e]/15 bg-[#0b0906]/95 px-6 py-4 md:hidden">
          <div className="flex flex-col gap-3 text-sm text-[#8a7c68]">
            {NAV_LINKS.map((link) => (
              <button
                key={link.target}
                onClick={() => {
                  scrollTo(link.target);
                  setOpen(false);
                }}
                className="text-left transition hover:text-[#f0e6cc]"
              >
                {link.label}
              </button>
            ))}
            <div className="mt-2 flex gap-3">
              <Link
                href="/login"
                className="flex-1 rounded-xl border border-[#c9a96e]/20 py-2.5 text-center text-sm font-semibold text-[#e0d2ba]"
              >
                Login
              </Link>
              <Link
                href="/login"
                className="flex-1 rounded-xl bg-[#c9a96e] py-2.5 text-center text-sm font-bold text-[#1a0e00]"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/*  Hero                                                                       */
/* -------------------------------------------------------------------------- */

function Hero({ scrollTo }: { scrollTo: (id: string) => void }) {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 lp-grid" />
      <div className="pointer-events-none absolute inset-0">
        <div className="lp-glow absolute left-1/2 top-[-260px] h-[720px] w-[1100px] -translate-x-1/2 rounded-full bg-[#c9a96e]/10 blur-3xl" />
        <div className="lp-glow absolute right-[-140px] top-[220px] h-[460px] w-[460px] rounded-full bg-[#8a6a2e]/10 blur-3xl" />
        <div className="lp-glow absolute bottom-[-200px] left-[-140px] h-[520px] w-[520px] rounded-full bg-[#c9a96e]/[0.06] blur-3xl" />
      </div>

      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-6 py-20 lg:grid-cols-[1fr_540px] lg:py-28">
        <div>
          <div
            data-reveal
            className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#c9a96e]/25 bg-[#c9a96e]/10 px-4 py-2 text-xs font-semibold text-[#e5cf9d]"
          >
            <span className="lp-pulse-ring h-1.5 w-1.5 rounded-full bg-[#c9a96e]" />
            Professional Legal AI · Built for India
          </div>

          <h1
            data-reveal
            style={{ "--reveal-delay": "80ms" } as React.CSSProperties}
            className="text-5xl font-black leading-[1.04] tracking-tight text-[#f0e6cc] md:text-7xl"
          >
            The AI legal associate
            <span className="mt-2 block lp-shimmer">your firm can trust.</span>
          </h1>

          <p
            data-reveal
            style={{ "--reveal-delay": "160ms" } as React.CSSProperties}
            className="mt-7 max-w-xl text-lg leading-8 text-[#a99a82] md:text-xl"
          >
            Legal AI unifies document intelligence, cited legal research, drafting,
            multilingual support, and safety guardrails — so law firms, agencies, and
            counsel get clearer, source-backed answers in seconds.
          </p>

          <div
            data-reveal
            style={{ "--reveal-delay": "240ms" } as React.CSSProperties}
            className="mt-10 flex flex-col gap-4 sm:flex-row"
          >
            <Link
              href="/login"
              className="rounded-2xl bg-[#c9a96e] px-8 py-4 text-center text-lg font-bold text-[#1a0e00] shadow-xl shadow-[#c9a96e]/20 transition hover:-translate-y-0.5 hover:bg-[#d9bd86] hover:shadow-[#c9a96e]/40"
            >
              Get Started
            </Link>
            <Link
              href="/login"
              className="group rounded-2xl border border-[#c9a96e]/25 bg-[#c9a96e]/[0.04] px-8 py-4 text-center text-lg font-bold text-[#f0e6cc] transition hover:border-[#c9a96e]/45 hover:bg-[#c9a96e]/10"
            >
              Book a Demo
              <span className="ml-2 inline-block transition group-hover:translate-x-1">→</span>
            </Link>
          </div>

          <div
            data-reveal
            style={{ "--reveal-delay": "320ms" } as React.CSSProperties}
            className="mt-11 grid max-w-2xl grid-cols-2 gap-4 md:grid-cols-4"
          >
            {STATS.map((s) => (
              <div
                key={s.label}
                className="rounded-2xl border border-[#c9a96e]/12 bg-[#c9a96e]/[0.03] p-4"
              >
                <p className="text-2xl font-black text-[#c9a96e]">{s.value}</p>
                <p className="mt-1 text-xs leading-5 text-[#8a7c68]">{s.label}</p>
              </div>
            ))}
          </div>

          <p className="mt-6 text-xs text-[#6f6152]">
            AI-assisted legal information. Always verify important legal decisions with a
            qualified lawyer.
          </p>
        </div>

        <div
          data-reveal
          style={{ "--reveal-delay": "200ms" } as React.CSSProperties}
          className="lp-float rounded-[2rem] border border-[#c9a96e]/15 bg-[#0f0c08]/90 p-4 shadow-2xl shadow-black/50"
        >
          <ChatPreview scrollTo={scrollTo} />
        </div>
      </div>
    </section>
  );
}

function ChatPreview({ scrollTo }: { scrollTo: (id: string) => void }) {
  return (
    <div className="rounded-[1.5rem] border border-[#c9a96e]/12 bg-[#0b0906]">
      <div className="flex items-center justify-between border-b border-[#c9a96e]/12 px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-[#d16a5a]/80" />
          <div className="h-3 w-3 rounded-full bg-[#d9b45a]/80" />
          <div className="h-3 w-3 rounded-full bg-[#7fbf7f]/80" />
        </div>
        <span className="text-xs font-medium text-[#8a7c68]">Legal AI Chat</span>
      </div>

      <div className="min-h-[520px] space-y-5 px-5 py-6">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#c9a96e] text-sm font-black text-[#1a0e00]">
            L
          </div>
          <div className="max-w-[360px] rounded-3xl rounded-tl-md border border-[#c9a96e]/12 bg-[#c9a96e]/[0.05] px-5 py-4 text-sm leading-6 text-[#c8b998]">
            Welcome to Legal AI. Upload a document or ask a legal question in your
            preferred language.
          </div>
        </div>

        <div className="flex justify-end">
          <div className="max-w-[360px] rounded-3xl rounded-tr-md bg-[#c9a96e] px-5 py-4 text-sm font-medium leading-6 text-[#1a0e00] shadow-lg shadow-[#c9a96e]/20">
            Explain this FIR in simple Hindi and tell me the next steps.
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#c9a96e] text-sm font-black text-[#1a0e00]">
            L
          </div>
          <div className="max-w-[400px] rounded-3xl rounded-tl-md border border-[#c9a96e]/12 bg-[#c9a96e]/[0.05] px-5 py-4 text-sm leading-6 text-[#c8b998]">
            <p className="font-semibold text-[#f0e6cc]">Summary</p>
            <p className="mt-2">
              I reviewed the uploaded document, extracted the key facts, and prepared a
              simple explanation.
            </p>
            <div className="mt-4 rounded-2xl border border-[#c9a96e]/20 bg-[#c9a96e]/10 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[#e5cf9d]">
                Suggested next steps
              </p>
              <ul className="mt-2 space-y-1 text-xs text-[#c8b998]">
                <li>• Verify FIR number, police station, and sections.</li>
                <li>• Keep copies of ID, complaint, and supporting proof.</li>
                <li>• Consult an advocate before filing any reply.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-2">
          {["PDF + OCR", "API Search", "Citation Check"].map((item) => (
            <div
              key={item}
              className="rounded-2xl border border-[#c9a96e]/12 bg-[#c9a96e]/[0.03] px-3 py-3 text-center text-xs font-semibold text-[#8a7c68]"
            >
              {item}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-[#c9a96e]/12 p-4">
        <div className="flex items-center gap-3 rounded-2xl border border-[#c9a96e]/12 bg-[#c9a96e]/[0.03] p-3">
          <span className="flex-1 text-sm text-[#8a7c68]">
            Ask about FIR, bail, contract, notice, judgment...
          </span>
          <button
            onClick={() => scrollTo("features")}
            className="rounded-xl bg-[#c9a96e] px-4 py-2 text-sm font-bold text-[#1a0e00]"
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Trust bar                                                                  */
/* -------------------------------------------------------------------------- */

function TrustBar() {
  const items = [...TRUST, ...TRUST];
  return (
    <section className="border-y border-[#c9a96e]/12 bg-[#c9a96e]/[0.02] py-10">
      <p className="mb-7 text-center text-xs font-semibold uppercase tracking-[0.25em] text-[#8a7c68]">
        Trusted by legal professionals across India
      </p>
      <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]">
        <div className="lp-marquee-track flex w-max items-center gap-12 px-6">
          {items.map((name, i) => (
            <span
              key={`${name}-${i}`}
              className="whitespace-nowrap text-lg font-bold tracking-tight text-[#8a7c68]/70"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Benefits                                                                   */
/* -------------------------------------------------------------------------- */

function Benefits() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <SectionHeading
        eyebrow="Why Legal AI"
        title="Outcomes your practice can measure"
        subtitle="Built to give lawyers, agencies, and in-house teams real leverage — not just another chatbot."
      />
      <div className="grid gap-6 md:grid-cols-3">
        {BENEFITS.map((b, i) => (
          <div
            key={b.title}
            data-reveal
            style={{ "--reveal-delay": `${i * 90}ms` } as React.CSSProperties}
            className="rounded-[2rem] border border-[#c9a96e]/12 bg-[#c9a96e]/[0.03] p-8 transition hover:-translate-y-1 hover:border-[#c9a96e]/35"
          >
            <p className="text-5xl font-black text-[#c9a96e]">{b.stat}</p>
            <h3 className="mt-5 text-xl font-bold text-[#f0e6cc]">{b.title}</h3>
            <p className="mt-3 text-sm leading-7 text-[#a99a82]">{b.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Features                                                                   */
/* -------------------------------------------------------------------------- */

function Features() {
  return (
    <section id="features" className="border-y border-[#c9a96e]/12 bg-[#c9a96e]/[0.02]">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <SectionHeading
          eyebrow="Features"
          title="Everything a modern legal team needs"
          subtitle="Document intelligence, cited research, drafting, and multilingual access — wrapped in safety guardrails."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              data-reveal
              style={{ "--reveal-delay": `${(i % 3) * 90}ms` } as React.CSSProperties}
              className="group rounded-[2rem] border border-[#c9a96e]/12 bg-[#0f0c08] p-7 transition hover:-translate-y-1 hover:border-[#c9a96e]/35 hover:bg-[#c9a96e]/[0.04]"
            >
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[#c9a96e]/15 bg-[#c9a96e]/[0.06] text-3xl">
                {f.icon}
              </span>
              <h3 className="mt-5 text-xl font-bold text-[#f0e6cc] transition group-hover:text-[#e5cf9d]">
                {f.title}
              </h3>
              <p className="mt-3 text-sm leading-7 text-[#a99a82]">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Workflow                                                                   */
/* -------------------------------------------------------------------------- */

function Workflow() {
  return (
    <section id="workflow" className="mx-auto max-w-7xl px-6 py-24">
      <SectionHeading
        eyebrow="Workflow"
        title="How Legal AI works"
        subtitle="A professional legal pipeline designed for retrieval, reasoning, safety, and citations."
      />
      <div className="grid gap-6 md:grid-cols-3">
        {WORKFLOW.map((item, i) => (
          <div
            key={item.step}
            data-reveal
            style={{ "--reveal-delay": `${i * 90}ms` } as React.CSSProperties}
            className="group relative overflow-hidden rounded-[2rem] border border-[#c9a96e]/12 bg-[#0f0c08] p-8 transition hover:-translate-y-1 hover:border-[#c9a96e]/35"
          >
            <span className="absolute -right-2 -top-4 select-none text-8xl font-black leading-none text-[#c9a96e]/10">
              {item.step}
            </span>
            <div className="relative">
              <span className="rounded-full border border-[#c9a96e]/20 bg-[#c9a96e]/10 px-3 py-1 text-xs font-bold text-[#e5cf9d]">
                Step {item.step}
              </span>
              <h3 className="mt-6 text-2xl font-bold text-[#f0e6cc]">{item.title}</h3>
              <p className="mt-4 text-sm leading-7 text-[#a99a82]">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Agentic system                                                             */
/* -------------------------------------------------------------------------- */

function AgenticSystem() {
  return (
    <section className="border-y border-[#c9a96e]/12 bg-[#c9a96e]/[0.02]">
      <div className="mx-auto grid max-w-7xl items-center gap-16 px-6 py-24 lg:grid-cols-2">
        <div data-reveal>
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-[#c9a96e]">
            Agentic System
          </p>
          <h2 className="mt-4 text-4xl font-black leading-tight text-[#f0e6cc] md:text-5xl">
            More than a chatbot.
            <span className="block text-[#c9a96e]">A legal workflow engine.</span>
          </h2>
          <p className="mt-6 text-lg leading-8 text-[#a99a82]">
            Legal AI runs a custom router-based multi-agent workflow. Every query passes
            through language detection, intent understanding, retrieval, guardrails,
            citation checks, and final legal reasoning.
          </p>
          <ul className="mt-9 space-y-5">
            {AGENTS.map(([name, desc]) => (
              <li key={name} className="flex gap-4 text-sm">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#c9a96e] shadow-lg shadow-[#c9a96e]/40" />
                <span>
                  <span className="font-bold text-[#f0e6cc]">{name}</span>
                  <span className="text-[#a99a82]"> — {desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div
          data-reveal
          style={{ "--reveal-delay": "120ms" } as React.CSSProperties}
          className="rounded-[2rem] border border-[#c9a96e]/15 bg-[#0b0906] p-8 font-mono text-sm shadow-2xl shadow-black/40"
        >
          <p className="mb-6 text-xs text-[#6f6152]">// Legal AI router_agent.py flow</p>
          {PIPELINE.map(([label, color], index) => (
            <div key={label}>
              <p className={color}>{label}</p>
              {index !== PIPELINE.length - 1 && (
                <p className="py-1 pl-5 text-[#4a4034]">↓</p>
              )}
            </div>
          ))}
          <div className="mt-8 grid grid-cols-3 gap-3 border-t border-[#c9a96e]/12 pt-6">
            {["Court Sources", "Legal DB", "Uploaded Docs"].map((src) => (
              <div
                key={src}
                className="rounded-2xl bg-[#c9a96e]/[0.05] px-3 py-3 text-center text-xs text-[#a99a82]"
              >
                {src}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pricing                                                                    */
/* -------------------------------------------------------------------------- */

function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-7xl px-6 py-24">
      <SectionHeading
        eyebrow="Pricing"
        title="Plans for citizens, advocates, and legal teams"
        subtitle="Start simple, then scale to professional research, team workflows, and enterprise legal intelligence."
      />
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {PRICING.map((plan, i) => (
          <div
            key={plan.name}
            data-reveal
            style={{ "--reveal-delay": `${i * 80}ms` } as React.CSSProperties}
            className={`flex flex-col rounded-[2rem] border p-7 transition hover:-translate-y-1 ${
              plan.highlight
                ? "border-[#c9a96e] bg-gradient-to-b from-[#c9a96e]/15 to-[#c9a96e]/[0.03] shadow-2xl shadow-[#c9a96e]/10"
                : "border-[#c9a96e]/12 bg-[#c9a96e]/[0.03]"
            }`}
          >
            {plan.highlight && (
              <span className="mb-5 self-start rounded-full border border-[#c9a96e]/20 bg-[#c9a96e]/15 px-3 py-1 text-xs font-bold text-[#e5cf9d]">
                Most Popular
              </span>
            )}
            <h3 className="text-2xl font-black text-[#f0e6cc]">{plan.name}</h3>
            <p className="mt-2 text-xs leading-5 text-[#8a7c68]">{plan.target}</p>
            <div className="mt-6 flex items-end gap-1">
              <span className="text-4xl font-black text-[#f0e6cc]">{plan.price}</span>
              {plan.period && (
                <span className="pb-1 text-sm text-[#8a7c68]">{plan.period}</span>
              )}
            </div>
            <ul className="mt-7 flex-1 space-y-3">
              {plan.features.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-sm leading-6 text-[#c8b998]"
                >
                  <span className="mt-0.5 shrink-0 text-[#c9a96e]">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/login"
              className={`mt-8 block rounded-2xl py-3.5 text-center text-sm font-bold transition ${
                plan.highlight
                  ? "bg-[#c9a96e] text-[#1a0e00] hover:bg-[#d9bd86]"
                  : "border border-[#c9a96e]/20 text-[#f0e6cc] hover:bg-[#c9a96e]/10"
              }`}
            >
              {plan.cta}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Testimonials                                                               */
/* -------------------------------------------------------------------------- */

function Testimonials() {
  return (
    <section className="border-y border-[#c9a96e]/12 bg-[#c9a96e]/[0.02]">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <SectionHeading
          eyebrow="Testimonials"
          title="Legal teams love working with Legal AI"
          subtitle="From corporate practices to legal-aid agencies — here's what professionals say."
        />
        <div className="grid gap-6 md:grid-cols-2">
          {TESTIMONIALS.map((t, i) => (
            <figure
              key={t.name}
              data-reveal
              style={{ "--reveal-delay": `${(i % 2) * 90}ms` } as React.CSSProperties}
              className="flex flex-col rounded-[2rem] border border-[#c9a96e]/12 bg-[#0f0c08] p-8 transition hover:-translate-y-1 hover:border-[#c9a96e]/30"
            >
              <div className="mb-4 text-[#c9a96e]" aria-hidden>
                ★★★★★
              </div>
              <blockquote className="flex-1 text-lg leading-8 text-[#d6c8ac]">
                “{t.quote}”
              </blockquote>
              <figcaption className="mt-7 flex items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#c9a96e]/20 bg-[#c9a96e]/10 text-sm font-black text-[#e5cf9d]">
                  {t.initials}
                </span>
                <span>
                  <span className="block font-bold text-[#f0e6cc]">{t.name}</span>
                  <span className="block text-sm text-[#8a7c68]">{t.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  FAQ                                                                        */
/* -------------------------------------------------------------------------- */

function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-24">
      <SectionHeading
        eyebrow="FAQ"
        title="Frequently asked questions"
        subtitle="Everything you need to know before you sign in."
      />
      <div className="space-y-4">
        {FAQS.map((item, i) => {
          const isOpen = openIndex === i;
          return (
            <div
              key={item.q}
              className={`overflow-hidden rounded-2xl border ${
                isOpen
                  ? "border-[#c9a96e]/35 bg-[#c9a96e]/[0.05]"
                  : "border-[#c9a96e]/12 bg-[#c9a96e]/[0.02]"
              }`}
            >
              <button
                onClick={() => setOpenIndex(isOpen ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                aria-expanded={isOpen}
              >
                <span className="text-base font-bold text-[#f0e6cc] md:text-lg">
                  {item.q}
                </span>
                <span className="shrink-0 text-xl text-[#c9a96e]">
                  {isOpen ? "×" : "+"}
                </span>
              </button>
              {isOpen && (
                <p className="px-6 pb-5 text-sm leading-7 text-[#a99a82]">{item.a}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Final CTA                                                                  */
/* -------------------------------------------------------------------------- */

function FinalCta() {
  return (
    <section className="mx-auto max-w-7xl px-6 pb-24">
      <div
        data-reveal
        className="relative overflow-hidden rounded-[2.5rem] border border-[#c9a96e]/25 bg-gradient-to-br from-[#c9a96e] via-[#b8965a] to-[#8a6a2e] p-10 text-center shadow-2xl shadow-[#c9a96e]/15 md:p-16"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.3),transparent_38%)]" />
        <div className="relative">
          <h2 className="mx-auto max-w-3xl text-4xl font-black leading-tight text-[#1a0e00] md:text-5xl">
            Legal research that is faster, safer, multilingual, and source-backed.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-[#3a2a10]">
            Give your firm AI-assisted document intelligence, cited legal retrieval,
            drafting, and regional-language support — in one professional platform.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/login"
              className="inline-block rounded-2xl bg-[#1a0e00] px-10 py-4 text-lg font-black text-[#f0e6cc] shadow-lg transition hover:-translate-y-0.5 hover:bg-[#25160a]"
            >
              Get Started
            </Link>
            <Link
              href="/login"
              className="inline-block rounded-2xl border border-[#1a0e00]/30 bg-white/20 px-10 py-4 text-lg font-black text-[#1a0e00] backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/30"
            >
              Book a Demo
            </Link>
          </div>
          <p className="mt-5 text-sm text-[#3a2a10]/80">
            Legal information only. Not a substitute for professional legal advice.
          </p>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Footer                                                                     */
/* -------------------------------------------------------------------------- */

function Footer() {
  return (
    <footer className="border-t border-[#c9a96e]/12 bg-[#0f0c08]">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#c9a96e]/30 bg-[#c9a96e]/10">
              <span className="text-lg">⚖️</span>
            </div>
            <span className="text-lg font-black text-[#f0e6cc]">
              Legal <span className="text-[#c9a96e]">AI</span>
            </span>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-7 text-[#8a7c68]">
            AI Legal Intelligence Platform for law firms, agencies, and legal
            professionals across India.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-xl bg-[#c9a96e] px-5 py-2.5 text-sm font-bold text-[#1a0e00] transition hover:bg-[#d9bd86]"
          >
            Login
          </Link>
        </div>

        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-[#e5cf9d]">
            Product
          </p>
          <ul className="mt-4 space-y-3 text-sm text-[#8a7c68]">
            <li>
              <Link href="/login" className="transition hover:text-[#f0e6cc]">
                Features
              </Link>
            </li>
            <li>
              <Link href="/login" className="transition hover:text-[#f0e6cc]">
                Pricing
              </Link>
            </li>
            <li>
              <Link href="/login" className="transition hover:text-[#f0e6cc]">
                Get Started
              </Link>
            </li>
            <li>
              <Link href="/login" className="transition hover:text-[#f0e6cc]">
                Book a Demo
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-[#e5cf9d]">
            Legal Resources
          </p>
          <ul className="mt-4 space-y-3 text-sm text-[#8a7c68]">
            <li>
              <a
                href="https://livelaw.in"
                target="_blank"
                rel="noreferrer"
                className="transition hover:text-[#f0e6cc]"
              >
                LiveLaw
              </a>
            </li>
            <li>
              <a
                href="https://barandbench.com"
                target="_blank"
                rel="noreferrer"
                className="transition hover:text-[#f0e6cc]"
              >
                Bar &amp; Bench
              </a>
            </li>
            <li>
              <a
                href="https://indiankanoon.org"
                target="_blank"
                rel="noreferrer"
                className="transition hover:text-[#f0e6cc]"
              >
                Indian Kanoon
              </a>
            </li>
            <li>
              <a
                href="mailto:pranjulm@observancegroup.com"
                className="transition hover:text-[#f0e6cc]"
              >
                Contact
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-[#c9a96e]/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-6 text-xs text-[#6f6152] md:flex-row">
          <p>© 2026 Legal AI. All rights reserved.</p>
          <p>AI-assisted legal information — not a substitute for professional legal advice.</p>
        </div>
      </div>
    </footer>
  );
}

/* -------------------------------------------------------------------------- */
/*  Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div data-reveal className="mx-auto mb-16 max-w-2xl text-center">
      <p className="text-sm font-bold uppercase tracking-[0.25em] text-[#c9a96e]">
        {eyebrow}
      </p>
      <h2 className="mt-4 text-4xl font-black text-[#f0e6cc] md:text-5xl">{title}</h2>
      <p className="mt-4 text-[#a99a82]">{subtitle}</p>
    </div>
  );
}

function useScrollReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));

    // Scroll-position based reveal. Unlike IntersectionObserver, this can never
    // leave an element stuck invisible after a fast or programmatic (anchor)
    // jump-scroll: anything at or above the trigger line — including content the
    // user has already scrolled past — is always revealed.
    let ticking = false;
    const reveal = () => {
      ticking = false;
      const trigger = window.innerHeight * 0.9;
      for (const el of els) {
        if (el.classList.contains("reveal-in")) continue;
        if (el.getBoundingClientRect().top < trigger) {
          el.classList.add("reveal-in");
        }
      }
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(reveal);
      }
    };

    reveal(); // reveal whatever is already in view on mount
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
}

"use client";

import { useRef } from "react";
import Link from "next/link";

const USE_CASES = [
  {
    icon: "📄",
    title: "Document Intelligence",
    desc: "Upload FIRs, contracts, judgments, notices, and court orders for source-backed legal analysis.",
  },
  {
    icon: "⚖️",
    title: "Indian Legal Research",
    desc: "Research case law, constitutional provisions, statutory sections, court precedents, and legal principles.",
  },
  {
    icon: "🛡️",
    title: "Guardrailed Legal AI",
    desc: "Built with PII masking, unsafe advice blocking, hallucination checks, citation validation, and confidence scoring.",
  },
  {
    icon: "🌍",
    title: "Multilingual Legal Help",
    desc: "Ask legal questions in English, Hindi, Urdu, Punjabi, Tamil, Telugu, Bengali, Marathi, Gujarati, Kannada, or Malayalam.",
  },
  {
    icon: "🔎",
    title: "OCR + RAG Pipeline",
    desc: "Extract, chunk, embed, retrieve, and reason over uploaded legal documents using semantic search.",
  },
  {
    icon: "🧠",
    title: "Professional Legal Workflow",
    desc: "Intent, router, document, API, web, translation, guardrail, and final-answer agents work together.",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Ask or Upload",
    desc: "Ask a legal question or upload an FIR, judgment, contract, court order, notice, or petition.",
  },
  {
    step: "02",
    title: "Retrieve Verified Context",
    desc: "Legal AI searches uploaded documents, legal APIs, court sources, legal databases, and trusted web sources.",
  },
  {
    step: "03",
    title: "Generate Cited Answer",
    desc: "The final answer is structured with citations, confidence checks, hallucination filtering, and a legal disclaimer.",
  },
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
      "Limited chat queries",
      "Multilingual responses",
      "Basic source-backed answers",
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
      "Team usage",
      "Bulk document analysis",
      "Advanced guardrails",
      "Confidence scoring",
      "Billing and usage tracking",
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
      "SSO and RBAC planned",
      "Audit logs planned",
      "Custom legal sources",
      "Dedicated support",
      "Enterprise integrations",
    ],
    cta: "Contact Us",
    highlight: false,
  },
];

const STATS = [
  { value: "8+", label: "Specialized AI agents" },
  { value: "11", label: "Indian languages" },
  { value: "5+", label: "Guardrail layers" },
  { value: "RAG", label: "OCR + vector retrieval" },
];

const AGENTS = [
  ["Intent Agent", "Detects whether the user needs research, document analysis, drafting, translation, or explanation."],
  ["Router Agent", "Controls the multi-agent workflow and decides the best retrieval path."],
  ["Document Agent", "Processes PDFs using OCR, chunking, embeddings, and vector search."],
  ["API Agent", "Retrieves structured information from legal APIs, court databases, and statutes."],
  ["Web Agent", "Fetches recent legal updates, public legal sources, and government notifications."],
  ["Guardrail Agent", "Applies safety, citation validation, PII filtering, and unsafe advice blocking."],
  ["Translation Agent", "Supports regional-language queries and returns answers in the user language."],
  ["Final Answer Agent", "Combines verified context into a structured legal response."],
];

export default function LandingPage() {
  const featuresRef = useRef<HTMLElement>(null);
  const howItWorksRef = useRef<HTMLElement>(null);
  const pricingRef = useRef<HTMLElement>(null);

  return (
    <div
      className="min-h-screen bg-[#070A13] text-white selection:bg-orange-500/30"
      style={{ fontFamily: "var(--font-geist-sans, Arial, sans-serif)" }}
    >
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#070A13]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="group flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-400/30 bg-orange-500/10 shadow-lg shadow-orange-500/10">
              <span className="text-xl">⚖️</span>
            </div>
            <div>
              <p className="text-xl font-black tracking-tight">
                Legal <span className="text-orange-400">AI</span>
              </p>
              <p className="text-xs text-gray-500">Legal Intelligence Platform</p>
            </div>
          </Link>

          <div className="hidden items-center gap-9 text-sm text-gray-400 md:flex">
            <button onClick={() => featuresRef.current?.scrollIntoView({ behavior: "smooth" })} className="transition hover:text-white">
              Features
            </button>
            <button onClick={() => howItWorksRef.current?.scrollIntoView({ behavior: "smooth" })} className="transition hover:text-white">
              Workflow
            </button>
            <button onClick={() => pricingRef.current?.scrollIntoView({ behavior: "smooth" })} className="transition hover:text-white">
              Pricing
            </button>
          </div>

          <Link
            href="/login"
            className="rounded-2xl bg-orange-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-600 hover:shadow-orange-500/40"
          >
            Launch App
          </Link>
        </div>
      </nav>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-[-220px] h-[760px] w-[1100px] -translate-x-1/2 rounded-full bg-orange-500/10 blur-3xl" />
          <div className="absolute right-[-120px] top-[280px] h-[480px] w-[480px] rounded-full bg-red-500/10 blur-3xl" />
          <div className="absolute bottom-[-180px] left-[-120px] h-[520px] w-[520px] rounded-full bg-blue-500/10 blur-3xl" />
        </div>

        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-6 py-20 lg:grid-cols-[1fr_560px] lg:py-28">
          <div>
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/10 px-4 py-2 text-xs font-semibold text-orange-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400" />
              Public + Professional Legal AI · India-focused
            </div>

            <h1 className="max-w-5xl text-5xl font-black leading-[1.05] tracking-tight md:text-7xl">
              Legal intelligence for lawyers and citizens.
              <span className="block bg-gradient-to-r from-orange-300 via-orange-400 to-red-400 bg-clip-text text-transparent">
                Built for India.
              </span>
            </h1>

            <p className="mt-7 max-w-2xl text-lg leading-8 text-gray-400 md:text-xl">
              Legal AI combines document intelligence, legal retrieval, multilingual support, RAG, and guardrails to produce clearer, source-backed legal answers.
            </p>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <Link
                href="/login"
                className="rounded-2xl bg-orange-500 px-8 py-4 text-center text-lg font-bold shadow-xl shadow-orange-500/20 transition hover:bg-orange-600 hover:shadow-orange-500/40 hover:-translate-y-0.5"
              >
                Start Legal Research
              </Link>
              <button
                onClick={() => howItWorksRef.current?.scrollIntoView({ behavior: "smooth" })}
                className="rounded-2xl border border-white/15 bg-white/5 px-8 py-4 text-lg font-bold transition hover:border-white/25 hover:bg-white/10"
              >
                See Workflow
              </button>
            </div>

            <div className="mt-10 grid max-w-2xl grid-cols-2 gap-4 md:grid-cols-4">
              {STATS.map((s) => (
                <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-2xl font-black text-orange-400">{s.value}</p>
                  <p className="mt-1 text-xs leading-5 text-gray-500">{s.label}</p>
                </div>
              ))}
            </div>

            <p className="mt-6 text-xs text-gray-500">
              AI-assisted legal information. Always verify important legal decisions with a qualified lawyer.
            </p>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-[#0E1424]/90 p-4 shadow-2xl shadow-black/40">
            <div className="rounded-[1.5rem] border border-white/10 bg-[#0B1120]">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-red-500/80" />
                  <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
                  <div className="h-3 w-3 rounded-full bg-green-500/80" />
                </div>
                <span className="text-xs font-medium text-gray-500">Legal AI Chat</span>
              </div>

              <div className="min-h-[560px] space-y-5 px-5 py-6">
                <div className="flex gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-sm font-black">
                    L
                  </div>
                  <div className="max-w-[390px] rounded-3xl rounded-tl-md border border-white/10 bg-white/[0.04] px-5 py-4 text-sm leading-6 text-gray-300">
                    Welcome to Legal AI. Upload a document or ask a legal question in your preferred language.
                  </div>
                </div>

                <div className="flex justify-end">
                  <div className="max-w-[390px] rounded-3xl rounded-tr-md bg-orange-500 px-5 py-4 text-sm font-medium leading-6 text-white shadow-lg shadow-orange-500/20">
                    Explain this FIR in simple Hindi and tell me the next steps.
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-sm font-black">
                    L
                  </div>
                  <div className="max-w-[430px] rounded-3xl rounded-tl-md border border-white/10 bg-white/[0.04] px-5 py-4 text-sm leading-6 text-gray-300">
                    <p className="font-semibold text-white">Summary</p>
                    <p className="mt-2">
                      I checked the uploaded document first, extracted the key facts, and prepared a simple explanation.
                    </p>
                    <div className="mt-4 rounded-2xl border border-orange-400/20 bg-orange-500/10 p-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-orange-300">Suggested next steps</p>
                      <ul className="mt-2 space-y-1 text-xs text-gray-300">
                        <li>• Verify FIR number, police station, and sections.</li>
                        <li>• Keep copies of ID, complaint, and supporting proof.</li>
                        <li>• Consult an advocate before filing any reply.</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-2">
                  {["PDF + OCR", "API Search", "Citation Check"].map((item) => (
                    <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-center text-xs font-semibold text-gray-400">
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-white/10 p-4">
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <span className="flex-1 text-sm text-gray-500">Ask about FIR, bail, contract, notice, judgment...</span>
                  <Link href="/login" className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white">
                    Ask
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section ref={howItWorksRef} className="border-y border-white/10 bg-white/[0.03]">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-orange-400">Workflow</p>
            <h2 className="mt-4 text-4xl font-black md:text-5xl">How Legal AI Works</h2>
            <p className="mt-4 text-gray-400">
              A professional legal AI pipeline designed for retrieval, reasoning, safety, and citations.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step} className="group relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#0B1120] p-8 transition hover:-translate-y-1 hover:border-orange-500/40">
                <span className="absolute -right-2 -top-4 select-none text-8xl font-black leading-none text-orange-500/10">
                  {item.step}
                </span>
                <div className="relative">
                  <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs font-bold text-orange-300">
                    Step {item.step}
                  </span>
                  <h3 className="mt-6 text-2xl font-bold">{item.title}</h3>
                  <p className="mt-4 text-sm leading-7 text-gray-400">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section ref={featuresRef} className="mx-auto max-w-7xl px-6 py-24">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-orange-400">Features</p>
          <h2 className="mt-4 text-4xl font-black md:text-5xl">Professional legal AI, simple public access</h2>
          <p className="mt-4 text-gray-400">
            Built around document intelligence, legal research, multilingual access, and safer legal outputs.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {USE_CASES.map((uc) => (
            <div
              key={uc.title}
              className="group rounded-[2rem] border border-white/10 bg-white/[0.03] p-7 transition hover:-translate-y-1 hover:border-orange-500/40 hover:bg-orange-500/[0.04]"
            >
              <span className="text-4xl">{uc.icon}</span>
              <h3 className="mt-5 text-xl font-bold transition group-hover:text-orange-300">{uc.title}</h3>
              <p className="mt-3 text-sm leading-7 text-gray-400">{uc.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.03]">
        <div className="mx-auto grid max-w-7xl items-center gap-16 px-6 py-24 lg:grid-cols-2">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-orange-400">Agentic System</p>
            <h2 className="mt-4 text-4xl font-black leading-tight md:text-5xl">
              More than a chatbot.
              <span className="block text-orange-400">A legal workflow engine.</span>
            </h2>

            <p className="mt-6 text-lg leading-8 text-gray-400">
              Legal AI uses a custom router-based multi-agent workflow. Each query passes through language detection,
              intent understanding, retrieval, guardrails, citation checks, and final legal reasoning.
            </p>

            <ul className="mt-9 space-y-5">
              {AGENTS.map(([name, desc]) => (
                <li key={name} className="flex gap-4 text-sm">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-orange-400 shadow-lg shadow-orange-400/40" />
                  <span>
                    <span className="font-bold text-white">{name}</span>
                    <span className="text-gray-400"> — {desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-[#0B1120] p-8 font-mono text-sm shadow-2xl shadow-black/30">
            <p className="mb-6 text-xs text-gray-500">&#47;&#47; Legal AI router_agent.py flow</p>
            {[
              ["User Question", "text-orange-400"],
              ["Language Detection", "text-blue-400"],
              ["Intent Understanding", "text-green-400"],
              ["Legal Retrieval Layer", "text-purple-400"],
              ["RAG Context Collection", "text-yellow-400"],
              ["LLM Legal Reasoning", "text-cyan-400"],
              ["Citation + Hallucination Check", "text-red-400"],
              ["Final Legal Answer", "text-orange-400"],
            ].map(([label, color], index) => (
              <div key={label}>
                <p className={color}>{label}</p>
                {index !== 7 && <p className="py-1 pl-5 text-gray-700">↓</p>}
              </div>
            ))}

            <div className="mt-8 grid grid-cols-3 gap-3 border-t border-white/10 pt-6">
              {["Court Sources", "Legal DB", "Uploaded Docs"].map((src) => (
                <div key={src} className="rounded-2xl bg-white/[0.04] px-3 py-3 text-center text-xs text-gray-400">
                  {src}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section ref={pricingRef} className="mx-auto max-w-7xl px-6 py-24">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-orange-400">Pricing</p>
          <h2 className="mt-4 text-4xl font-black md:text-5xl">Plans for citizens, advocates, and legal teams</h2>
          <p className="mt-4 text-gray-400">
            Start simple, then scale to professional research, team workflows, and enterprise legal intelligence.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {PRICING.map((plan) => (
            <div
              key={plan.name}
              className={`flex flex-col rounded-[2rem] border p-7 transition hover:-translate-y-1 ${
                plan.highlight
                  ? "border-orange-500 bg-gradient-to-b from-orange-500/15 to-white/[0.03] shadow-2xl shadow-orange-500/10"
                  : "border-white/10 bg-white/[0.03]"
              }`}
            >
              {plan.highlight && (
                <span className="mb-5 self-start rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs font-bold text-orange-300">
                  Most Popular
                </span>
              )}

              <h3 className="text-2xl font-black">{plan.name}</h3>
              <p className="mt-2 text-xs leading-5 text-gray-500">{plan.target}</p>

              <div className="mt-6 flex items-end gap-1">
                <span className="text-4xl font-black">{plan.price}</span>
                {plan.period && <span className="pb-1 text-sm text-gray-400">{plan.period}</span>}
              </div>

              <ul className="mt-7 flex-1 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm leading-6 text-gray-300">
                    <span className="mt-0.5 shrink-0 text-orange-400">✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href="/login"
                className={`mt-8 block rounded-2xl py-3.5 text-center text-sm font-bold transition ${
                  plan.highlight ? "bg-orange-500 hover:bg-orange-600" : "border border-white/15 hover:bg-white/5"
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="relative overflow-hidden rounded-[2.5rem] border border-orange-400/20 bg-gradient-to-r from-orange-500 to-red-500 p-10 text-center shadow-2xl shadow-orange-500/20 md:p-16">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.28),transparent_35%)]" />
          <div className="relative">
            <h2 className="mx-auto max-w-3xl text-4xl font-black leading-tight md:text-5xl">
              Build legal research that is faster, safer, multilingual, and source-backed.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-white/80">
              Use AI-assisted document intelligence, legal retrieval, guardrails, and regional-language support in one professional platform.
            </p>
            <Link
              href="/login"
              className="mt-9 inline-block rounded-2xl bg-white px-10 py-4 text-lg font-black text-gray-950 shadow-lg transition hover:-translate-y-0.5 hover:bg-gray-100"
            >
              Launch Legal AI
            </Link>
            <p className="mt-5 text-sm text-white/70">
              Legal information only. Not a substitute for professional legal advice.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-[#0B1120]">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 px-6 py-10 text-sm text-gray-500 md:flex-row">
          <div className="flex items-center gap-2">
            <span className="font-black text-white">
              Legal <span className="text-orange-400">AI</span>
            </span>
            <span>— AI Legal Intelligence Platform</span>
          </div>

          <div className="flex flex-wrap justify-center gap-6">
            <a href="https://livelaw.in" target="_blank" rel="noreferrer" className="transition hover:text-white">
              LiveLaw
            </a>
            <a href="https://barandbench.com" target="_blank" rel="noreferrer" className="transition hover:text-white">
              Bar & Bench
            </a>
            <a href="https://indiankanoon.org" target="_blank" rel="noreferrer" className="transition hover:text-white">
              Indian Kanoon
            </a>
            <a href="mailto:pranjulm@observancegroup.com" className="transition hover:text-white">
              Contact
            </a>
          </div>

          <p>© 2026 Legal AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

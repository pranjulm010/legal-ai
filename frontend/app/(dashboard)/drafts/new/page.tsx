"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { generateDraft, listCases, type CaseListItem } from "@/lib/api";

const TEMPLATES: { label: string; title: string; prompt: string }[] = [
  {
    label: "NDA",
    title: "Mutual Non-Disclosure Agreement",
    prompt: "Draft a mutual non-disclosure agreement between two Indian companies exploring a business relationship, with a 3-year term and 5-year survival of confidentiality obligations.",
  },
  {
    label: "Employment Agreement",
    title: "Employment Agreement",
    prompt: "Draft an employment agreement for a full-time employee in India, including probation period, compensation, confidentiality, IP assignment, and termination notice terms.",
  },
  {
    label: "Lease Agreement",
    title: "Residential Lease Agreement",
    prompt: "Draft an 11-month residential rental agreement under Indian law, including rent, security deposit, maintenance responsibilities, and termination notice periods.",
  },
  {
    label: "Service Agreement",
    title: "Service Agreement",
    prompt: "Draft a services agreement between an Indian service provider and client, including scope of work, payment terms, deliverables, and limitation of liability.",
  },
  {
    label: "Partnership Deed",
    title: "Partnership Deed",
    prompt: "Draft a partnership deed for a new partnership firm in India, including capital contribution, profit-sharing ratio, admission/retirement of partners, and dispute resolution.",
  },
  {
    label: "Power of Attorney",
    title: "General Power of Attorney",
    prompt: "Draft a general power of attorney under Indian law authorizing an agent to act on behalf of the principal for property and financial matters.",
  },
  {
    label: "Affidavit",
    title: "Affidavit",
    prompt: "Draft a general-purpose affidavit format under Indian law with placeholders for the deponent's statement of facts.",
  },
  {
    label: "Legal Notice",
    title: "Legal Notice",
    prompt: "Draft a legal notice under Indian law to be sent to a party in breach of contract, demanding remedy within 15 days before further legal action.",
  },
  {
    label: "Petition",
    title: "Petition",
    prompt: "Draft a civil petition format under Indian civil procedure, with placeholders for parties, facts, grounds, and prayer for relief.",
  },
  {
    label: "Bail Application",
    title: "Bail Application",
    prompt: "Draft a bail application under Indian criminal procedure (CrPC/BNSS), including placeholders for case facts and grounds for bail.",
  },
  {
    label: "Arbitration Agreement",
    title: "Arbitration Agreement",
    prompt: "Draft an arbitration clause/agreement under the Indian Arbitration and Conciliation Act, specifying seat, number of arbitrators, and governing law.",
  },
  {
    label: "Privacy Policy",
    title: "Privacy Policy",
    prompt: "Draft a privacy policy for an Indian SaaS company, covering data collected, purpose of use, third-party sharing, user rights, and grievance officer contact as required under Indian data protection law.",
  },
  {
    label: "Terms of Service",
    title: "Terms of Service",
    prompt: "Draft terms of service for an Indian SaaS product, covering acceptable use, payment, liability limitation, termination, and governing law/jurisdiction.",
  },
  {
    label: "Vendor Agreement",
    title: "Vendor Agreement",
    prompt: "Draft a vendor agreement between an Indian company and a supplier, including delivery terms, payment terms, quality standards, and termination rights.",
  },
];

export default function NewDraftPage() {
  const router = useRouter();

  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [caseId, setCaseId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCases().then(setCases);
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const draft = await generateDraft({
        title,
        prompt,
        case_id: caseId || undefined,
      });
      router.push(`/drafts/${draft.id}`);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to generate draft.");
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-[#f0e6cc]">New draft</h1>

      <div className="max-w-2xl">
        <p className="mb-2 text-xs text-[#8a7c68]">Start from a template (optional):</p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              onClick={() => {
                setTitle(template.title);
                setPrompt(template.prompt);
              }}
              className="rounded-full border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#8a7c68] hover:border-[#c9a96e]/40 hover:text-[#c9a96e]"
            >
              {template.label}
            </button>
          ))}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex max-w-2xl flex-col gap-4 rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5"
      >
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[#8a7c68]">Title</label>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            placeholder="e.g. Software Licensing Agreement"
            className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[#8a7c68]">
            What do you want drafted?
          </label>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            required
            rows={6}
            placeholder="e.g. Draft a 2-year software licensing agreement between an Indian vendor and client, with a 30-day termination notice period."
            className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[#8a7c68]">Case (optional)</label>
          <select
            value={caseId}
            onChange={(event) => setCaseId(event.target.value)}
            className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba]"
          >
            <option value="">No case</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
        >
          {submitting ? "Generating..." : "Generate draft"}
        </button>
      </form>
    </div>
  );
}

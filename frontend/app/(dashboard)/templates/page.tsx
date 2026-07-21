"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  type TemplateDetail,
  type TemplateListItem,
} from "@/lib/api";

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<TemplateDetail | null>(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = () => {
    listTemplates()
      .then(setTemplates)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError("Please choose a sample document.");
      return;
    }
    setCreating(true);
    setError(null);
    setCreated(null);

    try {
      const template = await createTemplate({ name, description, file });
      setCreated(template);
      setName("");
      setDescription("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      refresh();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to create template.");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this template?")) return;
    await deleteTemplate(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#f0e6cc]">Templates</h1>
          <p className="mt-1 text-sm text-[#8a7c68]">
            Upload a sample document once. The AI learns its structure, tone and
            formatting so future drafts come out in the same format.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/drafts/new"
            className="rounded-lg border border-[#c9a96e]/25 px-4 py-2 text-sm text-[#c9a96e] hover:border-[#c9a96e]/50"
          >
            + New draft
          </Link>
          <button
            onClick={() => {
              setShowForm((prev) => !prev);
              setError(null);
              setCreated(null);
            }}
            className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00]"
          >
            {showForm ? "Cancel" : "+ New template"}
          </button>
        </div>
      </div>

      {/* Create template */}
      {showForm && (
      <form
        onSubmit={handleCreate}
        className="flex max-w-2xl flex-col gap-4 rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5"
      >
        <p className="text-sm font-semibold text-[#e0d2ba]">New template</p>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {created && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            Created “{created.name}” — {created.placeholders.length} placeholder
            {created.placeholders.length === 1 ? "" : "s"} detected. Use it from
            the New draft page.
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[#8a7c68]">Template name</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            placeholder="e.g. Residential Rental Agreement"
            className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[#8a7c68]">Description (optional)</label>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="When to use this template"
            className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[#8a7c68]">
            Sample document (.pdf, .docx, .txt, .md)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="text-sm text-[#8a7c68] file:mr-3 file:rounded-lg file:border-0 file:bg-[#c9a96e]/20 file:px-3 file:py-2 file:text-sm file:text-[#c9a96e]"
          />
        </div>

        <button
          type="submit"
          disabled={creating}
          className="w-fit rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
        >
          {creating ? "Analyzing sample…" : "Create template"}
        </button>
      </form>
      )}

      {/* Existing templates */}
      <div className="flex flex-col gap-3">
        {loading ? (
          <p className="text-sm text-[#8a7c68]">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-[#8a7c68]">No templates yet.</p>
        ) : (
          templates.map((template) => (
            <div
              key={template.id}
              className="flex items-center justify-between rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] px-5 py-4"
            >
              <div>
                <p className="text-base text-[#e0d2ba]">{template.name}</p>
                <p className="text-xs text-[#8a7c68]">
                  {template.description || "Template"} · v{template.version} ·{" "}
                  {template.placeholder_count} placeholder
                  {template.placeholder_count === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Link
                  href={`/drafts/new?template=${template.id}`}
                  className="text-[#c9a96e] hover:underline"
                >
                  Use
                </Link>
                <button
                  onClick={() => handleDelete(template.id)}
                  className="rounded-lg border border-red-500/30 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

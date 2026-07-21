"use client";

// Small shared building blocks for the Settings tabs so every section keeps
// the same look, spacing, and notice/error treatment.

export const inputClass =
  "rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50";

export const selectClass =
  "rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba]";

export const primaryButtonClass =
  "rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50";

export const secondaryButtonClass =
  "rounded-lg border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#c9a96e] disabled:opacity-50";

export const dangerButtonClass =
  "rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50";

export function SettingsCard({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[#f0e6cc]">{title}</h2>
          {subtitle && <p className="text-xs text-[#5a4f3f]">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 px-3 py-2 text-sm text-[#c9a96e]">
      {children}
    </div>
  );
}

export function ErrorNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {children}
    </div>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: "green" | "gold" | "yellow" | "muted";
  children: React.ReactNode;
}) {
  const tones = {
    green: "bg-green-500/10 text-green-400",
    gold: "bg-[#c9a96e]/15 text-[#c9a96e]",
    yellow: "bg-yellow-500/10 text-yellow-400",
    muted: "bg-[#c9a96e]/5 text-[#8a7c68]",
  } as const;

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] ${tones[tone]}`}>{children}</span>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-[#8a7c68]">{label}</label>
      {children}
    </div>
  );
}

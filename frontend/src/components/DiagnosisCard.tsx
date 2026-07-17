import { useState } from "react";
import type { Diagnosis } from "../types";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  InfoIcon,
  ShieldIcon,
  SparkleIcon,
  TargetIcon,
  TerminalIcon,
  WrenchIcon,
} from "./icons";

function confidenceStyle(confidence: number) {
  if (confidence >= 80) return "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25";
  if (confidence >= 50) return "bg-amber-500/10 text-amber-400 ring-amber-500/25";
  return "bg-red-500/10 text-red-400 ring-red-500/25";
}

function Section({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <span className="text-slate-500">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1.5">{children}</dd>
    </div>
  );
}

export default function DiagnosisCard({ diagnosis }: { diagnosis: Diagnosis }) {
  const [copied, setCopied] = useState(false);

  async function copyCommands() {
    try {
      await navigator.clipboard.writeText(diagnosis.kubectl_commands.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable (e.g. insecure context) — silently ignore */
    }
  }

  return (
    <div className="animate-fade-up overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-900/60 shadow-xl shadow-black/20 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4 border-b border-slate-800/70 bg-slate-900/80 px-5 py-4">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold text-slate-200">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-md shadow-blue-500/25">
            <SparkleIcon className="h-4.5 w-4.5" />
          </span>
          AI Diagnosis
          <span className="hidden rounded-full bg-slate-800 px-2.5 py-0.5 text-[0.65rem] font-medium text-slate-400 ring-1 ring-inset ring-slate-700 sm:inline">
            {diagnosis.source === "llm" ? (diagnosis.model ?? "LLM") : "rule-based"}
          </span>
        </h2>
        <span
          className={`inline-flex items-baseline gap-1 rounded-full px-3 py-1 text-sm font-bold ring-1 ring-inset ${confidenceStyle(diagnosis.confidence)}`}
        >
          {diagnosis.confidence}%
          <span className="text-[0.65rem] font-medium opacity-70">confidence</span>
        </span>
      </div>

      <dl className="space-y-5 p-5 text-sm">
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.07] p-4">
          <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-300">
            <TargetIcon className="h-3.5 w-3.5" />
            Root Cause
          </dt>
          <dd className="mt-1.5 text-base font-medium leading-relaxed text-slate-100">
            {diagnosis.root_cause}
          </dd>
        </div>

        <Section icon={<InfoIcon className="h-3.5 w-3.5" />} label="Explanation">
          <p className="leading-relaxed text-slate-300">{diagnosis.explanation}</p>
        </Section>

        <Section icon={<WrenchIcon className="h-3.5 w-3.5" />} label="Suggested Fix">
          <p className="leading-relaxed text-slate-300">{diagnosis.fix}</p>
        </Section>

        {diagnosis.kubectl_commands.length > 0 && (
          <Section icon={<TerminalIcon className="h-3.5 w-3.5" />} label="kubectl Commands">
            <div className="group relative">
              <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-4 pr-12 text-xs leading-relaxed text-emerald-300">
                {diagnosis.kubectl_commands.join("\n")}
              </pre>
              <button
                type="button"
                onClick={() => void copyCommands()}
                title="Copy commands"
                className={`absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-md border text-xs transition-all ${
                  copied
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                    : "border-slate-700 bg-slate-900 text-slate-400 opacity-0 hover:border-slate-600 hover:text-slate-200 group-hover:opacity-100"
                }`}
              >
                {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
              </button>
            </div>
          </Section>
        )}

        {diagnosis.prevention && (
          <Section icon={<ShieldIcon className="h-3.5 w-3.5" />} label="Prevention">
            <p className="leading-relaxed text-slate-300">{diagnosis.prevention}</p>
          </Section>
        )}

        <details className="group rounded-xl border border-slate-800/70 bg-slate-950/40 open:bg-slate-950/60">
          <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-300">
            Why this confidence level?
            <ChevronDownIcon className="h-4 w-4 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <p className="px-4 pb-4 leading-relaxed text-slate-400">
            {diagnosis.confidence_reasoning}
          </p>
        </details>
      </dl>
    </div>
  );
}

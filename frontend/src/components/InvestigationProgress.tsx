import type { ProgressStep } from "../types";
import { CheckIcon, SparkleIcon, XIcon } from "./icons";

function StepIcon({ status }: { status: ProgressStep["status"] }) {
  if (status === "done")
    return (
      <span className="z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
        <CheckIcon className="h-3.5 w-3.5" />
      </span>
    );
  if (status === "error")
    return (
      <span className="z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-red-500/15 text-red-400 ring-1 ring-inset ring-red-500/30">
        <XIcon className="h-3.5 w-3.5" />
      </span>
    );
  if (status === "running")
    return (
      <span className="z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-500/15 ring-1 ring-inset ring-blue-500/30">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
      </span>
    );
  return (
    <span className="z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-900 ring-1 ring-inset ring-slate-700">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
    </span>
  );
}

interface Props {
  steps: ProgressStep[];
  rootCauseFound: boolean;
  title?: string;
}

export default function InvestigationProgress({
  steps,
  rootCauseFound,
  title = "Investigation Status",
}: Props) {
  return (
    <div className="animate-fade-up rounded-2xl border border-slate-800/70 bg-slate-900/60 p-5 shadow-xl shadow-black/20 backdrop-blur-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h2>

      <div className="relative mt-4">
        {/* connector line through the step icons */}
        <div aria-hidden className="absolute bottom-3 left-[11px] top-3 w-px bg-slate-800" />
        <ul className="space-y-3.5 text-sm">
          {steps.map((step) => (
            <li key={step.key} className="relative flex items-center gap-3">
              <StepIcon status={step.status} />
              <span
                className={
                  step.status === "pending"
                    ? "text-slate-500"
                    : step.status === "running"
                      ? "font-medium text-blue-300"
                      : "text-slate-200"
                }
              >
                {step.label}
              </span>
            </li>
          ))}
          {rootCauseFound && (
            <li className="relative flex items-center gap-3 animate-fade-in">
              <span className="z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-400 text-white shadow-md shadow-emerald-500/30">
                <SparkleIcon className="h-3.5 w-3.5" />
              </span>
              <span className="font-semibold text-emerald-300">Root Cause Found</span>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

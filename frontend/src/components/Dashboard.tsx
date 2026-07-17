import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useInvestigation } from "../hooks/useInvestigation";
import { useHistory } from "../hooks/useHistory";
import { useClusters } from "../hooks/useClusters";
import { useLiveProgress } from "../hooks/useLiveProgress";
import { INITIAL_STEPS } from "../lib/steps";
import { friendlyErrorMessage } from "../lib/errors";
import Header from "./Header";
import InvestigateButton from "./InvestigateButton";
import SystemStatus from "./SystemStatus";
import ClusterSelector from "./ClusterSelector";
import InvestigationProgress from "./InvestigationProgress";
import DiagnosisCard from "./DiagnosisCard";
import HistoryTable from "./HistoryTable";
import { AlertTriangleIcon, CheckCircleIcon, XIcon } from "./icons";

export default function Dashboard() {
  const { user } = useAuth();
  const investigation = useInvestigation();
  const history = useHistory(Boolean(user));
  const clusters = useClusters(Boolean(user));
  const liveEvent = useLiveProgress(user?.id ?? null);
  const [selectedContext, setSelectedContext] = useState<string | null>(null);

  const clusterList = clusters.data?.clusters ?? [];
  const currentContext = clusters.data?.current_context ?? null;
  // The cluster investigations run against: user's pick, else kubeconfig default.
  const targetContext = selectedContext ?? currentContext;

  const diagnosis = investigation.data?.diagnosis ?? null;
  const result = investigation.data?.investigation;
  const clusterUnreachable = result ? !result.cluster_reachable : false;
  const clusterHealthy = result ? result.cluster_reachable && result.issues_found === 0 : false;
  const showProgress = investigation.isPending || investigation.data || investigation.isError;
  const steps = liveEvent?.progress?.length ? liveEvent.progress : INITIAL_STEPS;

  function investigate(context: string | null) {
    if (context) setSelectedContext(context);
    investigation.mutate(context ?? undefined);
  }

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100">
      {/* ambient background glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-48 left-1/2 h-[28rem] w-[44rem] -translate-x-1/2 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute -bottom-40 right-[-10rem] h-96 w-[32rem] rounded-full bg-cyan-500/5 blur-3xl" />
      </div>

      <Header />

      <main className="relative mx-auto max-w-4xl space-y-6 px-6 py-10">
        <section className="animate-fade-up flex flex-col items-center gap-5 overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-900/60 p-8 text-center shadow-xl shadow-black/20 backdrop-blur-sm sm:p-10">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Troubleshoot Kubernetes{" "}
            <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              with AI
            </span>
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
            Run an on-demand investigation: collect cluster evidence, reason about it with AI, and
            get a root cause with a suggested fix.
          </p>
          <InvestigateButton
            onClick={() => investigate(targetContext)}
            loading={investigation.isPending}
          />
          <SystemStatus />

          <ClusterSelector
            clusters={clusterList}
            loading={clusters.isLoading}
            error={
              clusters.isError
                ? friendlyErrorMessage(clusters.error)
                : (clusters.data?.error ?? null)
            }
            selected={targetContext}
            disabled={investigation.isPending}
            onInvestigate={(context) => investigate(context)}
          />
        </section>

        {showProgress && (
          <InvestigationProgress
            steps={steps}
            rootCauseFound={Boolean(diagnosis) && !clusterHealthy}
            title={
              investigation.isPending ? "Investigating Kubernetes Cluster..." : "Investigation Status"
            }
          />
        )}

        {investigation.isError && (
          <div className="animate-fade-up flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.08] p-4 text-sm text-red-300">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-red-500/15 text-red-400">
              <XIcon className="h-4.5 w-4.5" />
            </span>
            <p className="pt-1.5">{friendlyErrorMessage(investigation.error)}</p>
          </div>
        )}

        {clusterUnreachable && (
          <div className="animate-fade-up flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-4 text-sm text-amber-200">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-400">
              <AlertTriangleIcon className="h-4.5 w-4.5" />
            </span>
            <div className="pt-0.5">
              <p className="font-medium">
                Unable to connect to the Kubernetes cluster
                {investigation.data?.cluster ? ` "${investigation.data.cluster}"` : ""}.
              </p>
              <p className="mt-2 text-amber-300/80">Please verify:</p>
              <ul className="mt-1 list-inside list-disc text-amber-300/80">
                <li>the cluster is running and reachable from this machine</li>
                <li>the kubeconfig path and selected context are correct</li>
                <li>
                  kubectl works:{" "}
                  <code className="rounded bg-amber-900/40 px-1.5 py-0.5">kubectl get nodes</code>
                </li>
              </ul>
            </div>
          </div>
        )}

        {clusterHealthy && (
          <div className="animate-fade-up flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.07] p-4 text-sm">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <CheckCircleIcon className="h-4.5 w-4.5" />
            </span>
            <div>
              <p className="font-medium text-emerald-300">No critical Kubernetes issues detected.</p>
              <p className="mt-0.5 text-emerald-400/70">Cluster appears healthy.</p>
            </div>
          </div>
        )}

        {investigation.data?.ai_error && (
          <div className="animate-fade-up flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-4 text-sm text-amber-300">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-400">
              <AlertTriangleIcon className="h-4.5 w-4.5" />
            </span>
            <p className="pt-1.5">
              Evidence was collected, but AI reasoning was unavailable:{" "}
              {investigation.data.ai_error}
            </p>
          </div>
        )}

        {diagnosis && !clusterHealthy && <DiagnosisCard diagnosis={diagnosis} />}

        <HistoryTable records={history.data ?? []} loading={history.isLoading} />
      </main>
    </div>
  );
}

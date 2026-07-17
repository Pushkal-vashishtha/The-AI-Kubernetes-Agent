import type { ClusterInfo } from "../types";
import { ArrowRightIcon, ServerIcon } from "./icons";

interface Props {
  clusters: ClusterInfo[];
  loading: boolean;
  error: string | null;
  selected: string | null;
  disabled: boolean;
  onInvestigate: (context: string) => void;
}

/**
 * Every cluster found in the local kubeconfig. Clicking a cluster
 * starts an investigation against that cluster.
 */
export default function ClusterSelector({
  clusters,
  loading,
  error,
  selected,
  disabled,
  onInvestigate,
}: Props) {
  if (loading) {
    return (
      <div className="grid w-full gap-2.5 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-[4.25rem] animate-pulse rounded-xl border border-slate-800/60 bg-slate-800/30"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-amber-400">Could not list clusters: {error}</p>;
  }

  if (clusters.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No clusters found in the kubeconfig on the backend machine.
      </p>
    );
  }

  return (
    <div className="w-full text-left">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        Your Clusters
        <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">
          click one to investigate it
        </span>
      </h3>
      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
        {clusters.map((cluster) => {
          const isSelected = cluster.context === selected;
          return (
            <button
              key={cluster.context}
              type="button"
              disabled={disabled}
              onClick={() => onInvestigate(cluster.context)}
              className={`group relative rounded-xl border p-3.5 text-left transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-60 ${
                isSelected
                  ? "border-blue-500/70 bg-blue-500/10 shadow-lg shadow-blue-500/10"
                  : "border-slate-800 bg-slate-950/60 hover:-translate-y-0.5 hover:border-slate-600 hover:bg-slate-900 hover:shadow-lg hover:shadow-black/20"
              }`}
            >
              <span className="flex items-center gap-3">
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors ${
                    isSelected
                      ? "bg-blue-500/20 text-blue-300"
                      : "bg-slate-800/80 text-slate-400 group-hover:text-slate-200"
                  }`}
                >
                  <ServerIcon className="h-4.5 w-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-100">
                      {cluster.context}
                    </span>
                    {cluster.current && (
                      <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-slate-400 ring-1 ring-inset ring-slate-700">
                        default
                      </span>
                    )}
                  </span>
                  {cluster.cluster && cluster.cluster !== cluster.context && (
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {cluster.cluster}
                    </span>
                  )}
                </span>
                <ArrowRightIcon
                  className={`h-4 w-4 shrink-0 transition-all duration-200 ${
                    isSelected
                      ? "text-blue-400"
                      : "-translate-x-1 text-slate-600 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                  }`}
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

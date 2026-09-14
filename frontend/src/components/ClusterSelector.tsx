import { useState } from "react";
import type { ClusterInfo } from "../types";
import { ArrowRightIcon, ServerIcon, XIcon } from "./icons";

interface Props {
  clusters: ClusterInfo[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  disabled: boolean;
  onInvestigate: (clusterId: string) => void;
  onAdd: () => void;
  onRemove: (clusterId: string) => void;
  removingId: string | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

type Tone = "ready" | "waiting" | "offline";

/** What the card should say about whether this cluster can be used here. */
function describe(cluster: ClusterInfo): { tone: Tone; label: string; hint: string | null } {
  if (cluster.mode === "local") {
    return cluster.available
      ? { tone: "ready", label: "Ready", hint: null }
      : {
          tone: "offline",
          label: "Other backend",
          hint: `Kubeconfig cluster registered on ${cluster.host ?? "another backend"}`,
        };
  }
  if (cluster.available) return { tone: "ready", label: "Connected", hint: null };
  if (cluster.status === "pending") {
    return { tone: "waiting", label: "Waiting for agent", hint: "Run the install command to connect it" };
  }
  return { tone: "offline", label: "Offline", hint: `Agent last seen ${timeAgo(cluster.last_seen_at)}` };
}

const DOT: Record<Tone, string> = {
  ready: "bg-emerald-400",
  waiting: "bg-amber-400",
  offline: "bg-slate-600",
};

/**
 * The user's clusters. Clicking an available cluster investigates it;
 * unavailable ones are disabled and say why.
 */
export default function ClusterSelector({
  clusters,
  loading,
  error,
  selectedId,
  disabled,
  onInvestigate,
  onAdd,
  onRemove,
  removingId,
}: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const addButton = (
    <button
      type="button"
      onClick={onAdd}
      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-slate-100"
    >
      + Add cluster
    </button>
  );

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
      <div className="w-full rounded-xl border border-dashed border-slate-700 p-6 text-center">
        <ServerIcon className="mx-auto h-6 w-6 text-slate-500" />
        <p className="mt-2 text-sm font-medium text-slate-200">Add your first cluster</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
          Install a small read-only agent into any Kubernetes cluster with one command. It connects
          out to us, so nothing in your cluster needs to be exposed.
        </p>
        <div className="mt-4 flex justify-center">{addButton}</div>
      </div>
    );
  }

  return (
    <div className="w-full text-left">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Your Clusters
          <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">
            click one to investigate it
          </span>
        </h3>
        {addButton}
      </div>

      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
        {clusters.map((cluster) => {
          const isSelected = cluster.id === selectedId;
          const { tone, label, hint } = describe(cluster);
          const usable = cluster.available && !disabled;
          const confirming = confirmingId === cluster.id;
          const removing = removingId === cluster.id;

          return (
            <div key={cluster.id} className="group relative">
              <button
                type="button"
                disabled={!usable}
                onClick={() => onInvestigate(cluster.id)}
                title={hint ?? undefined}
                className={`relative w-full rounded-xl border p-3.5 pr-10 text-left transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed ${
                  isSelected
                    ? "border-blue-500/70 bg-blue-500/10 shadow-lg shadow-blue-500/10"
                    : cluster.available
                      ? "border-slate-800 bg-slate-950/60 hover:-translate-y-0.5 hover:border-slate-600 hover:bg-slate-900 hover:shadow-lg hover:shadow-black/20"
                      : "border-slate-800/60 bg-slate-950/30 opacity-60"
                }`}
              >
                <span className="flex items-center gap-3">
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors ${
                      isSelected ? "bg-blue-500/20 text-blue-300" : "bg-slate-800/80 text-slate-400"
                    }`}
                  >
                    <ServerIcon className="h-4.5 w-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-100">{cluster.name}</span>
                      <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-slate-400 ring-1 ring-inset ring-slate-700">
                        {cluster.mode === "agent" ? "agent" : "kubeconfig"}
                      </span>
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
                      <span className="truncate">
                        {label}
                        {hint && tone !== "ready" ? ` · ${hint}` : ""}
                        {tone === "ready" && cluster.distro && cluster.distro !== "kubeconfig"
                          ? ` · ${cluster.distro}`
                          : ""}
                      </span>
                    </span>
                  </span>
                  {cluster.available && (
                    <ArrowRightIcon
                      className={`h-4 w-4 shrink-0 transition-all duration-200 ${
                        isSelected
                          ? "text-blue-400"
                          : "-translate-x-1 text-slate-600 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                      }`}
                    />
                  )}
                </span>
              </button>

              {/* Only agent clusters are removable here: local ones come from a
                  backend's kubeconfig and would simply be re-registered. */}
              {cluster.mode === "agent" && !confirming && (
                <button
                  type="button"
                  onClick={() => setConfirmingId(cluster.id)}
                  disabled={removing}
                  aria-label={`Remove ${cluster.name}`}
                  className="absolute right-2 top-2 rounded-md p-1 text-slate-600 opacity-0 transition-all hover:bg-slate-800 hover:text-red-300 focus:opacity-100 group-hover:opacity-100"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              )}

              {confirming && (
                <div className="absolute inset-0 flex items-center justify-between gap-2 rounded-xl border border-red-500/40 bg-slate-950/95 px-3.5 text-sm">
                  <span className="text-slate-300">
                    Remove <strong className="text-slate-100">{cluster.name}</strong>? Its agent is disconnected
                    immediately.
                  </span>
                  <span className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="rounded-md px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingId(null);
                        onRemove(cluster.id);
                      }}
                      className="rounded-md bg-red-500/90 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500"
                    >
                      Remove
                    </button>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

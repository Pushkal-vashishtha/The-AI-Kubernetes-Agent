import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ClusterInfo } from "../types";
import { useCreateCluster } from "../hooks/useClusterMutations";
import { friendlyErrorMessage } from "../lib/errors";
import InstallCommandPanel from "./InstallCommandPanel";
import { XIcon } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  // The live cluster list, so the dialog can tell when the new agent connects.
  clusters: ClusterInfo[];
}

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

/**
 * Enrol a cluster: pick a name, get a one-time install command, run it, and
 * watch the agent come online. The token lives only in this component's
 * state -- never in storage -- and is dropped when the dialog closes.
 */
export default function AddClusterDialog({ open, onClose, clusters }: Props) {
  const create = useCreateCluster();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string; token: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset everything, including the token, whenever the dialog closes.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    setName("");
    setCreated(null);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const live = created ? clusters.find((c) => c.id === created.id) : undefined;
  const connected = live?.status === "online";
  const trimmed = name.trim();
  const nameValid = NAME_PATTERN.test(trimmed);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nameValid) return;
    const result = await create.mutateAsync(trimmed).catch(() => null);
    if (result) {
      setCreated({ id: result.cluster.id, name: result.cluster.name, token: result.agent_token });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-cluster-title"
        className="animate-fade-up w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 text-left shadow-2xl shadow-black/40"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="add-cluster-title" className="text-lg font-semibold text-slate-100">
              {created ? `Install the agent on "${created.name}"` : "Add a cluster"}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {created
                ? "Run this where kubectl points at the cluster. The agent is read-only and connects out to us."
                : "Any cluster works — cloud, on-prem or kind. Nothing needs to be exposed."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {!created && (
          <form onSubmit={handleSubmit} className="mt-5">
            <label htmlFor="cluster-name" className="text-sm font-medium text-slate-300">
              Cluster name
            </label>
            <input
              id="cluster-name"
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="production-eu"
              autoComplete="off"
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3.5 py-2.5 text-slate-100 placeholder-slate-600 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Letters, digits, dot, dash or underscore. You'll see this name in the dashboard.
            </p>

            {create.isError && (
              <p className="mt-3 text-sm text-red-400">{friendlyErrorMessage(create.error)}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm text-slate-400 transition-colors hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!nameValid || create.isPending}
                className="rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              >
                {create.isPending ? "Creating..." : "Create cluster"}
              </button>
            </div>
          </form>
        )}

        {created && (
          <div className="mt-5 space-y-4">
            <InstallCommandPanel token={created.token} cluster={live} />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700"
              >
                {connected ? "Done" : "Close — I'll run it later"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

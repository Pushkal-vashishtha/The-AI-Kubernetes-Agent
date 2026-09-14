import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ClusterInfo } from "../types";
import { useCreateCluster } from "../hooks/useClusterMutations";
import { apiIsLocalOnly, installCommand } from "../services/cluster.service";
import { friendlyErrorMessage } from "../lib/errors";
import { AlertTriangleIcon, CheckCircleIcon, CheckIcon, CopyIcon, TerminalIcon, XIcon } from "./icons";

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
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset everything, including the token, whenever the dialog closes.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    setName("");
    setCreated(null);
    setCopied(false);
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
  const command = created ? installCommand(created.token) : "";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nameValid) return;
    const result = await create.mutateAsync(trimmed).catch(() => null);
    if (result) {
      setCreated({ id: result.cluster.id, name: result.cluster.name, token: result.agent_token });
    }
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (http, iframes); the command is selectable anyway.
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
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This command contains the cluster's token and <strong>won't be shown again</strong>. If you
                lose it, remove the cluster and add it again.
              </span>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
                <span className="flex items-center gap-2 text-xs font-medium text-slate-400">
                  <TerminalIcon className="h-3.5 w-3.5" /> Terminal
                </span>
                <button
                  type="button"
                  onClick={copyCommand}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800"
                >
                  {copied ? <CheckIcon className="h-3.5 w-3.5 text-emerald-400" /> : <CopyIcon className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-cyan-200">
                <code className="select-all whitespace-pre-wrap break-all">{command}</code>
              </pre>
            </div>

            {apiIsLocalOnly() && (
              <p className="text-xs text-slate-500">
                The API is on localhost, which pods can't reach. For kind, add{" "}
                <code className="text-slate-300">--server http://host.docker.internal:8000</code>.
              </p>
            )}

            <div
              aria-live="polite"
              className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${
                connected
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : "border-slate-800 bg-slate-950/60 text-slate-400"
              }`}
            >
              {connected ? (
                <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-400" />
              ) : (
                <span className="relative flex h-3 w-3 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/60" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-400" />
                </span>
              )}
              <span>
                {connected
                  ? `Connected${live?.distro ? ` — ${live.distro}` : ""}. You can investigate it now.`
                  : "Waiting for the agent to connect…"}
              </span>
            </div>

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

import { useEffect, useState } from "react";
import type { ClusterInfo } from "../types";
import { useRotateClusterToken } from "../hooks/useClusterMutations";
import { friendlyErrorMessage } from "../lib/errors";
import InstallCommandPanel from "./InstallCommandPanel";
import { XIcon } from "./icons";

interface Props {
  // The cluster whose token to rotate; null keeps the dialog closed.
  cluster: ClusterInfo | null;
  onClose: () => void;
  clusters: ClusterInfo[];
}

/**
 * Rotate an agent cluster's token. Asks first, because the running agent is
 * disconnected the moment it happens, then shows the new install command.
 * The new token lives only in this component's state.
 */
export default function RotateTokenDialog({ cluster, onClose, clusters }: Props) {
  const rotate = useRotateClusterToken();
  const [token, setToken] = useState<string | null>(null);
  const open = cluster !== null;

  useEffect(() => {
    if (open) return;
    setToken(null);
    rotate.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!cluster) return null;

  const live = clusters.find((c) => c.id === cluster.id);
  const connected = token !== null && live?.status === "online";

  async function confirmRotate() {
    if (!cluster) return;
    const result = await rotate.mutateAsync(cluster.id).catch(() => null);
    if (result) setToken(result.agent_token);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rotate-token-title"
        className="animate-fade-up w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 text-left shadow-2xl shadow-black/40"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="rotate-token-title" className="text-lg font-semibold text-slate-100">
              Rotate token for "{cluster.name}"
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {token
                ? "Re-run the installer with the new token. It updates the agent in place."
                : "Use this if the token leaked or was lost. The cluster and its history are kept."}
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

        {!token && (
          <div className="mt-5">
            <p className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
              The current token stops working <strong>immediately</strong>, and the running agent disconnects.
              The cluster stays offline until you reinstall the agent with the new token.
            </p>

            {rotate.isError && (
              <p className="mt-3 text-sm text-red-400">{friendlyErrorMessage(rotate.error)}</p>
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
                type="button"
                onClick={confirmRotate}
                disabled={rotate.isPending}
                className="rounded-lg bg-amber-500/90 px-4 py-2 text-sm font-medium text-slate-950 transition-opacity hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rotate.isPending ? "Rotating..." : "Rotate token"}
              </button>
            </div>
          </div>
        )}

        {token && (
          <div className="mt-5 space-y-4">
            <InstallCommandPanel token={token} cluster={live} />
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

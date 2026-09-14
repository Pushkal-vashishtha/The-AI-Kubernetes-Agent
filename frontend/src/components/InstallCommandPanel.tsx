import { useState } from "react";
import type { ClusterInfo } from "../types";
import { apiIsLocalOnly, installCommand } from "../services/cluster.service";
import { AlertTriangleIcon, CheckCircleIcon, CheckIcon, CopyIcon, TerminalIcon } from "./icons";

interface Props {
  // The one-time agent token. Held by the parent only while its dialog is open.
  token: string;
  // The live row for this cluster, so the panel can show the agent connecting.
  cluster: ClusterInfo | undefined;
}

/**
 * The install command for a freshly minted token, plus a live "waiting for
 * the agent" indicator. Shared by adding a cluster and rotating its token.
 */
export default function InstallCommandPanel({ token, cluster }: Props) {
  const [copied, setCopied] = useState(false);
  const command = installCommand(token);
  const connected = cluster?.status === "online";

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
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          This command contains the cluster's token and <strong>won't be shown again</strong>. If you lose
          it, rotate the token to get a new one.
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
            ? `Connected${cluster?.distro ? ` — ${cluster.distro}` : ""}. You can investigate it now.`
            : "Waiting for the agent to connect…"}
        </span>
      </div>
    </div>
  );
}

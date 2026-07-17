import type { InvestigationRecord } from "../types";
import { ClockIcon } from "./icons";

function statusBadge(status: InvestigationRecord["status"]) {
  const styles = {
    completed: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25",
    running: "bg-blue-500/10 text-blue-400 ring-blue-500/25",
    failed: "bg-red-500/10 text-red-400 ring-red-500/25",
  } as const;
  return styles[status] ?? "bg-slate-800 text-slate-300 ring-slate-700";
}

interface Props {
  records: InvestigationRecord[];
  loading: boolean;
}

export default function HistoryTable({ records, loading }: Props) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-900/60 p-5 shadow-xl shadow-black/20 backdrop-blur-sm">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <ClockIcon className="h-4 w-4 text-slate-500" />
        Recent Investigations
      </h2>

      {loading ? (
        <div className="mt-4 space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-800/40" />
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-800 py-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-800/60 text-slate-500">
            <ClockIcon className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium text-slate-400">No investigations yet</p>
          <p className="text-xs text-slate-500">Pick a cluster above and run your first one.</p>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[0.68rem] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-4 font-semibold">When</th>
                <th className="py-2 pr-4 font-semibold">Root Cause</th>
                <th className="py-2 pr-4 font-semibold">Cluster</th>
                <th className="py-2 pr-4 font-semibold">Namespace</th>
                <th className="py-2 pr-4 font-semibold">Confidence</th>
                <th className="py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {records.map((record) => (
                <tr key={record.id} className="transition-colors hover:bg-slate-800/30">
                  <td className="whitespace-nowrap py-2.5 pr-4 text-slate-400">
                    {new Date(record.created_at).toLocaleString()}
                  </td>
                  <td
                    className="max-w-xs truncate py-2.5 pr-4 text-slate-200"
                    title={record.root_cause ?? ""}
                  >
                    {record.root_cause ?? "—"}
                  </td>
                  <td
                    className="max-w-[10rem] truncate py-2.5 pr-4 text-slate-400"
                    title={record.cluster ?? ""}
                  >
                    {record.cluster ?? "—"}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-400">{record.namespace ?? "—"}</td>
                  <td className="py-2.5 pr-4 font-medium text-slate-300">
                    {record.confidence !== null ? `${record.confidence}%` : "—"}
                  </td>
                  <td className="py-2.5">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadge(record.status)}`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {record.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

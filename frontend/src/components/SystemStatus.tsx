import { useHealthCheck } from "../hooks/useHealthCheck";

export default function SystemStatus() {
  const { data, isLoading, isError } = useHealthCheck();

  let label = "Unknown";
  let dot = "bg-slate-500";
  let text = "text-slate-400";
  let ping = false;

  if (isLoading) {
    label = "Checking...";
    dot = "bg-slate-400";
  } else if (isError) {
    label = "Backend Unreachable";
    dot = "bg-red-500";
    text = "text-red-400";
  } else if (data?.status === "healthy") {
    label = "Ready";
    dot = "bg-emerald-400";
    text = "text-emerald-400";
    ping = true;
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/80 px-3.5 py-1.5 text-xs font-medium text-slate-400">
      <span className="relative flex h-2 w-2">
        {ping && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dot} opacity-60`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
      </span>
      System Status: <span className={`font-semibold ${text}`}>{label}</span>
    </span>
  );
}

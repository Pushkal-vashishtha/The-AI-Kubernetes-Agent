import { ZapIcon } from "./icons";

interface Props {
  onClick: () => void;
  loading: boolean;
}

export default function InvestigateButton({ onClick, loading }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="group relative inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:shadow-xl hover:shadow-blue-500/35 hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100"
    >
      {loading ? (
        <>
          <span className="inline-block h-4.5 w-4.5 animate-spin rounded-full border-2 border-white/80 border-t-transparent" />
          Investigating...
        </>
      ) : (
        <>
          <ZapIcon className="h-5 w-5 transition-transform duration-300 group-hover:-rotate-12 group-hover:scale-110" />
          Investigate Cluster
        </>
      )}
    </button>
  );
}

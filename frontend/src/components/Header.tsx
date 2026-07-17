import { useAuth } from "../context/AuthContext";
import { HelmIcon, LogOutIcon } from "./icons";

export default function Header() {
  const { user, signOut } = useAuth();
  const initial = user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <header className="sticky top-0 z-20 border-b border-slate-800/70 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3.5">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-lg shadow-blue-500/25">
            <HelmIcon className="h-5.5 w-5.5" />
          </span>
          <div>
            <h1 className="text-base font-semibold leading-tight tracking-tight">
              AI Kubernetes Agent
            </h1>
            <p className="text-xs text-slate-500">Troubleshoot Kubernetes with AI</p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span className="hidden items-center gap-2 sm:flex">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-800 text-xs font-semibold text-slate-300 ring-1 ring-slate-700">
              {initial}
            </span>
            <span className="max-w-[14rem] truncate text-slate-400">{user?.email}</span>
          </span>
          <button
            onClick={() => void signOut()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 px-3 py-1.5 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800/60 hover:text-slate-100"
          >
            <LogOutIcon className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

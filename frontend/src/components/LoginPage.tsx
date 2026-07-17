import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { insforge } from "../lib/insforge";
import { GithubIcon, GoogleIcon, HelmIcon } from "./icons";

type Mode = "signin" | "signup" | "verify";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3.5 py-2.5 text-slate-100 placeholder-slate-600 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";

export default function LoginPage() {
  const { signIn, signUp, verifyEmail } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);

    try {
      if (mode === "signin") {
        const message = await signIn(email, password);
        if (message) setError(message);
      } else if (mode === "signup") {
        const result = await signUp(email, password);
        if (result.error) {
          setError(result.error);
        } else if (result.needsVerification) {
          setMode("verify");
          setInfo(`We sent a 6-digit code to ${email}. Enter it below to finish signing up.`);
        }
      } else {
        const message = await verifyEmail(email, otp.trim());
        if (message) setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleOAuth(provider: "github" | "google") {
    setError(null);
    await insforge.auth.signInWithOAuth(provider, { redirectTo: window.location.origin });
  }

  async function handleResend() {
    setError(null);
    await insforge.auth.resendVerificationEmail({ email });
    setInfo(`A new code was sent to ${email}.`);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 text-slate-100">
      {/* ambient background glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-96 w-[40rem] -translate-x-1/2 rounded-full bg-blue-500/15 blur-3xl" />
        <div className="absolute -bottom-32 right-[-8rem] h-80 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="flex flex-col items-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-xl shadow-blue-500/30">
            <HelmIcon className="h-8 w-8" />
          </span>
          <h1 className="mt-4 text-center text-2xl font-bold tracking-tight sm:text-3xl">
            AI Kubernetes Agent
          </h1>
          <p className="mt-1.5 text-center text-sm text-slate-400">
            Troubleshoot Kubernetes{" "}
            <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text font-medium text-transparent">
              with AI
            </span>
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="mt-8 rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-2xl shadow-black/40 backdrop-blur-sm"
        >
          <h2 className="text-lg font-semibold">
            {mode === "signin" ? "Welcome back" : mode === "signup" ? "Create account" : "Verify your email"}
          </h2>

          {info && (
            <p className="mt-3 rounded-lg border border-blue-500/25 bg-blue-500/10 p-2.5 text-sm text-blue-300">
              {info}
            </p>
          )}
          {error && (
            <p className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 p-2.5 text-sm text-red-300">
              {error}
            </p>
          )}

          {mode !== "verify" && (
            <>
              <label className="mt-4 block text-sm font-medium text-slate-400">
                Email
                <input
                  type="email"
                  required
                  value={email}
                  placeholder="you@example.com"
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="mt-3.5 block text-sm font-medium text-slate-400">
                Password
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  placeholder="••••••••"
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                />
              </label>
            </>
          )}

          {mode === "verify" && (
            <label className="mt-4 block text-sm font-medium text-slate-400">
              6-digit code
              <input
                type="text"
                required
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className={`${inputClass} text-center text-xl tracking-[0.5em]`}
              />
            </label>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 py-2.5 font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:shadow-blue-500/40 hover:brightness-110 active:scale-[0.99] disabled:opacity-50 disabled:hover:brightness-100"
          >
            {busy ? "Please wait..." : mode === "signin" ? "Sign in" : mode === "signup" ? "Sign up" : "Verify"}
          </button>

          {mode === "verify" ? (
            <button
              type="button"
              onClick={handleResend}
              className="mt-3 w-full text-sm text-slate-400 transition-colors hover:text-slate-200"
            >
              Resend code
            </button>
          ) : (
            <>
              <div className="mt-5 flex items-center gap-3 text-xs text-slate-600">
                <div className="h-px flex-1 bg-slate-800" />
                or continue with
                <div className="h-px flex-1 bg-slate-800" />
              </div>
              <div className="mt-3.5 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleOAuth("github")}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800/60"
                >
                  <GithubIcon className="h-4 w-4" />
                  GitHub
                </button>
                <button
                  type="button"
                  onClick={() => handleOAuth("google")}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800/60"
                >
                  <GoogleIcon className="h-4 w-4" />
                  Google
                </button>
              </div>
            </>
          )}
        </form>

        {mode !== "verify" && (
          <p className="mt-5 text-center text-sm text-slate-400">
            {mode === "signin" ? "No account yet?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
                setInfo(null);
              }}
              className="font-semibold text-blue-400 transition-colors hover:text-blue-300"
            >
              {mode === "signin" ? "Sign up" : "Sign in"}
            </button>
          </p>
        )}
      </div>
    </main>
  );
}

import { useAuth } from "./context/AuthContext";
import LoginPage from "./components/LoginPage";
import Dashboard from "./components/Dashboard";
import { HelmIcon } from "./components/icons";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950">
        <span className="grid h-14 w-14 animate-pulse place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-xl shadow-blue-500/30">
          <HelmIcon className="h-8 w-8" />
        </span>
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </main>
    );
  }

  return user ? <Dashboard /> : <LoginPage />;
}

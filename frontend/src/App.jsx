import { useEffect, useState } from "react";
import Auth from "./Auth";
import Dashboard from "./Dashboard";

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    fetch("/api/v1/auth/me", { credentials: "same-origin" })
      .then(r => r.ok ? r.json() : null)
      .then(data => setUser(data?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);
  async function signOut() {
    try {
      const r = await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!r.ok) throw new Error("Could not sign out. Please try again.");
      setUser(null);
    } catch (err) { window.alert(err.message); }
  }
  if (checking) return <div style={{ padding: 48, fontFamily: "Arial, sans-serif" }}>Opening Tracepoint…</div>;
  if (!user) return <Auth onAuthenticated={setUser} />;
  return <Dashboard user={user} onSignOut={signOut} />;
}

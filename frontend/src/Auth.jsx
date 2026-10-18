import { useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import "./Auth.css";

export default function Auth({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isSignup = mode === "signup";

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(isSignup ? { name, email, password } : { email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        const detail = data.detail;
        throw new Error(typeof detail === "string" ? detail : "Please check your details and try again.");
      }
      onAuthenticated(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setError("");
  }

  return (
    <div className="thread-auth">
      <section className="auth-left">
        <div className="auth-brand"><span>tracepoint<span className="auth-brand-dot">.</span></span></div>
        <div className="auth-form-area">
          <div className="auth-kicker">INCIDENT WORKSPACE</div>
          <h1>{isSignup ? "Create your workspace." : "Welcome back."}</h1>
          <p className="auth-subtitle">{isSignup ? "Get started with a clearer way to investigate incidents." : "Sign in to continue your investigations."}</p>
          <form onSubmit={submit}>
            {isSignup && <label>Full name<input required autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" minLength={2} /></label>}
            <label>Work email<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" /></label>
            <label>Password
              <div className="auth-password-wrap">
                <input type={showPassword ? "text" : "password"} required autoComplete={isSignup ? "new-password" : "current-password"} minLength={isSignup ? 10 : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder={isSignup ? "At least 10 characters" : "Enter your password"} />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
            </label>
            {error && <div role="alert" className="auth-error">{error}</div>}
            <button className="auth-submit" disabled={busy} type="submit">{busy ? "Please wait…" : isSignup ? "Create account" : "Sign in"}<ArrowRight size={17} /></button>
          </form>
          <p className="auth-switch">{isSignup ? "Already have an account?" : "New to Tracepoint?"} <button onClick={() => switchMode(isSignup ? "login" : "signup")}>{isSignup ? "Sign in" : "Create an account"}</button></p>
        </div>
        <footer className="auth-footer"><span>© Tracepoint · Tracepoint</span><span>AIORI 3 · PS-013</span></footer>
      </section>
      <section className="auth-right">
        <div className="auth-preview-label">BUILT FOR SMALL INCIDENT RESPONSE TEAMS</div>
        <div className="auth-preview-window">
          <div className="preview-top"><span className="preview-brand">tracepoint<span>.</span></span><span className="preview-top-pill">Workspace overview</span><span className="preview-avatar">ML</span></div>
          <div className="preview-body">
            <div className="preview-sidebar"><div className="preview-nav active">Overview</div><div className="preview-nav">Timeline</div><div className="preview-nav">Evidence</div><div className="preview-nav">Reports</div></div>
            <div className="preview-content"><div className="preview-small">WORKSPACE / OVERVIEW</div><h3>Incident overview</h3><p>A clearer view of your security activity.</p><div className="preview-metrics"><div><small>Events collected</small><strong>—</strong></div><div><small>Open investigations</small><strong>—</strong></div><div><small>Evidence batches</small><strong>—</strong></div></div><div className="preview-table"><div className="preview-table-title">Recent activity <span>Example layout</span></div><div className="preview-table-head">EVENT <span>STATUS</span></div><div className="preview-table-row"><span>Authentication event</span><em>Recorded</em></div><div className="preview-table-row"><span>Evidence received</span><em>Collected</em></div><div className="preview-table-row"><span>Timeline updated</span><em>Recorded</em></div></div></div>
          </div>
        </div>
        <div className="auth-preview-copy"><h2>Every event. One timeline.</h2><p>Collect the evidence. Connect the events. Understand the incident.</p></div>
      </section>
    </div>
  );
}

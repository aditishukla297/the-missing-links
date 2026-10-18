import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, X, ShieldAlert, FileText, Link2, Send, RefreshCw } from 'lucide-react';
import './Tracepoint.css';
import './investigations.css';

const API = '/api/v1/investigations';
const stamp = v => v ? new Date(v).toLocaleString() : '—';
const eventLabel = e => `${e.event_type || e.type || 'Event'} · ${e.device_id || e.hostname || 'Unknown device'} · ${e.username || 'Unknown user'} · ${stamp(e.timestamp || e.event_timestamp || e.received_at)}`;
const eventRef = e => JSON.stringify({ device_id: e.device_id || '', batch_id: e.batch_id || '', timestamp: e.timestamp || e.event_timestamp || e.received_at || '', event_type: e.event_type || e.type || '', username: e.username || '', message: String(e.message || e.raw_line || '').slice(0, 100) });

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${response.status})`);
  return body;
}

export default function Investigations({ events = [] }) {
  const [cases, setCases] = useState([]);
  const [active, setActive] = useState(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: '', description: '', severity: 'medium' });
  const [note, setNote] = useState('');
  const [eventIndex, setEventIndex] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadCases() {
    setLoading(true);
    try { const data = await request(API); setCases(data.items || []); setError(''); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadCases(); }, []);

  async function openCase(id) {
    try { setActive(await request(`${API}/${id}`)); setNote(''); setEventIndex(''); setError(''); }
    catch (err) { setError(err.message); }
  }

  async function perform(action) {
    setBusy(true); setError('');
    try { await action(); await loadCases(); if (active) await openCase(active.id); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function createCase(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await request(API, { method: 'POST', body: JSON.stringify(draft) });
      setCreating(false);
      setDraft({ title: '', description: '', severity: 'medium' });
      await loadCases();
      await openCase(result.id);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const visible = useMemo(() => cases.filter(c => `${c.id} ${c.title} ${c.description} ${c.status} ${c.severity}`.toLowerCase().includes(query.toLowerCase())), [cases, query]);
  const counts = { total: cases.length, open: cases.filter(c => c.status === 'open').length, investigating: cases.filter(c => c.status === 'investigating').length, resolved: cases.filter(c => c.status === 'resolved').length };
  const linked = new Set((active?.events || []).map(e => e.event_reference));
  const available = events.map((e, index) => ({ e, index })).filter(({ e }) => !linked.has(eventRef(e)));

  return <div className="tp-inv tp-inv-phase5">
    <div className="tp-inv-phase5-hero">
      <div>
        <span className="tp-inv-phase5-eyebrow"><ShieldAlert size={15}/> CASE MANAGEMENT / INVESTIGATIONS</span>
        <h2>Turn evidence into an investigation.</h2>
        <p>Organize security leads, link collected events, and document analyst findings with a clear case history.</p>
      </div>
      <span className="tp-inv-phase5-hero-count">{counts.total} {counts.total === 1 ? 'CASE' : 'CASES'} IN REGISTER</span>
    </div>
    <div className="tp-inv-metrics">
      {[['Total cases', counts.total], ['Open', counts.open], ['Investigating', counts.investigating], ['Resolved', counts.resolved]].map(([label, value]) =>
        <div className="tp-card tp-inv-metric" key={label}><span>{label}</span><strong>{value}</strong></div>
      )}
    </div>

    {error && <div className="tp-error" role="alert">{error}</div>}
    <section className="tp-card tp-inv-card tp-inv-phase5-register">
      <div className="tp-card-head"><div><h2>Investigation cases</h2><p>Track incidents, evidence links, and analyst findings</p></div>
        <div className="tp-inv-head-actions"><button className="tp-button" onClick={loadCases} disabled={loading}><RefreshCw size={15}/> Refresh</button><button className="tp-button primary" onClick={() => setCreating(true)}><Plus size={16}/> New investigation</button></div>
      </div>
      <div className="tp-toolbar"><label className="tp-search"><Search size={18}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search investigations" aria-label="Search investigations"/></label></div>
      {loading ? <div className="tp-inv-empty">Loading investigations…</div> : visible.length === 0 ?
        <div className="tp-inv-empty"><ShieldAlert size={25}/><strong>{cases.length ? 'No matching cases' : 'No investigations yet'}</strong><p>{cases.length ? 'Try another search.' : 'Create your first case to begin documenting an incident.'}</p></div> :
        <div className="tp-ev-table-wrap"><table className="tp-ev-table tp-inv-phase5-table"><thead><tr><th>Case</th><th>Severity</th><th>Status</th><th>Events</th><th>Updated</th></tr></thead><tbody>
          {visible.map(c => <tr key={c.id} className="tp-inv-clickable" tabIndex={0} role="button" onClick={() => openCase(c.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCase(c.id); } }}><td><strong className="tp-inv-case">TP-{String(c.id).padStart(4, '0')}</strong><div className="tp-inv-title">{c.title}</div></td><td><span className={`tp-inv-pill ${c.severity}`}>{c.severity}</span></td><td><span className={`tp-inv-pill ${c.status}`}>{c.status}</span></td><td>{c.event_count}</td><td>{stamp(c.updated_at)}</td></tr>)}
        </tbody></table></div>}
    </section>

    {creating && <div className="tp-overlay" onMouseDown={() => setCreating(false)}><aside className="tp-drawer" role="dialog" aria-modal="true" aria-label="Create investigation" onMouseDown={e => e.stopPropagation()}>
      <div className="tp-drawer-header"><div><span>New case</span><h2>Create investigation</h2></div><button onClick={() => setCreating(false)} aria-label="Close"><X size={21}/></button></div>
      <form className="tp-drawer-body tp-inv-form" onSubmit={createCase}>
        <label>Title<input required minLength={3} maxLength={160} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Repeated SSH login failures"/></label>
        <label>Description<textarea maxLength={3000} rows={5} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Describe the incident and initial findings"/></label>
        <label>Severity<select value={draft.severity} onChange={e => setDraft({ ...draft, severity: e.target.value })}>{['low', 'medium', 'high', 'critical'].map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <button className="tp-button primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create investigation'}</button>
      </form>
    </aside></div>}

    {active && !creating && <div className="tp-overlay" onMouseDown={() => setActive(null)}><aside className="tp-drawer tp-inv-drawer" role="dialog" aria-modal="true" aria-label="Investigation details" onMouseDown={e => e.stopPropagation()}>
      <div className="tp-drawer-header"><div><span>TP-{String(active.id).padStart(4, '0')}</span><h2>{active.title}</h2><span className={`tp-inv-pill ${active.severity}`}>{active.severity}</span></div><button onClick={() => setActive(null)} aria-label="Close"><X size={21}/></button></div>
      <div className="tp-drawer-body tp-inv-detail">
        <p className="tp-inv-description">{active.description || 'No description provided.'}</p>
        <div className="tp-detail"><span>Created</span><strong>{stamp(active.created_at)}</strong></div>
        <label className="tp-inv-status-label">Case status<select disabled={busy} value={active.status} onChange={e => perform(() => request(`${API}/${active.id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) }))}>{['open', 'investigating', 'resolved'].map(s => <option value={s} key={s}>{s}</option>)}</select></label>
        <button
          type="button"
          className="tp-button tp-inv-phase5-report"
          onClick={() => {
            window.open(
              `/api/v1/investigations/${active.id}/report`,
              "_blank"
            );
          }}
        >
          <FileText size={16}/> Download PDF report
        </button>
        <h3><Link2 size={16}/> Linked events ({active.events?.length || 0})</h3>
        {(active.events || []).map(link => <div className="tp-inv-linked" key={link.id}><FileText size={15}/><span>{(() => { try { return eventLabel(JSON.parse(link.event_reference)); } catch { return link.event_reference; } })()}</span></div>)}
        {available.length ? <div className="tp-inv-inline"><select aria-label="Select timeline event" value={eventIndex} onChange={e => setEventIndex(e.target.value)}><option value="">Select a timeline event…</option>{available.map(({ e, index }) => <option key={index} value={index}>{eventLabel(e)}</option>)}</select><button className="tp-button" disabled={busy || eventIndex === ''} onClick={() => perform(() => request(`${API}/${active.id}/events`, { method: 'POST', body: JSON.stringify({ event_reference: eventRef(events[Number(eventIndex)]) }) }))}>Link</button></div> : <p className="tp-inv-muted">No additional timeline events available.</p>}
        <h3>Analyst notes ({active.notes?.length || 0})</h3>
        <form onSubmit={e => { e.preventDefault(); const content = note.trim(); if (!content) return; perform(async () => { await request(`${API}/${active.id}/notes`, { method: 'POST', body: JSON.stringify({ content }) }); setNote(''); }); }}>
          <textarea rows={3} maxLength={5000} required value={note} onChange={e => setNote(e.target.value)} placeholder="Record findings, actions, or next steps…" aria-label="Analyst note"/>
          <button className="tp-button primary" disabled={busy || !note.trim()} type="submit"><Send size={15}/> Add note</button>
        </form>
        {(active.notes || []).map(n => <div className="tp-inv-note" key={n.id}><small>{stamp(n.created_at)}</small><p>{n.content}</p></div>)}
      </div>
    </aside></div>}
  </div>;
}

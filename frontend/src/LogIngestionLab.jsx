import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Database, FileCode2, Fingerprint, LoaderCircle, Send } from 'lucide-react';
import './LogIngestionLab.css';

export default function LogIngestionLab({ onIngested, onViewTimeline }) {
  const [scenarios, setScenarios] = useState([]);
  const [selected, setSelected] = useState('ssh_failures');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  useEffect(() => {
    let active = true;
    fetch('/api/v1/demo/scenarios', { credentials: 'same-origin' })
      .then(async r => { if (!r.ok) throw new Error(`Unable to load scenarios (HTTP ${r.status})`); return r.json(); })
      .then(data => { if (active) setScenarios(data.items || []); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  const scenario = scenarios.find(s => s.id === selected);
  async function ingest() {
    setLoading(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/v1/demo/ingest', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Tracepoint-Demo': '1' },
        body: JSON.stringify({ scenario: selected }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Ingestion failed (HTTP ${response.status})`);
      setResult(data);
      onIngested?.();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  return <div className="lab-root lab-phase7">
    <div className="lab-banner"><FileCode2 size={20}/><div><strong>Log Ingestion Lab</strong><p>Submit labeled sample logs through the real ingestion pipeline. Demo data is stored separately from existing device evidence.</p></div></div>
    <div className="lab-grid">
      <section className="tp-card lab-card"><h2>1. Raw log source</h2><p>Choose a sample scenario to inspect before ingestion.</p>
        <label className="lab-label" htmlFor="lab-scenario">Security scenario</label>
        <select id="lab-scenario" value={selected} onChange={e => { setSelected(e.target.value); setResult(null); }} disabled={loading}>
          {scenarios.map(s => <option value={s.id} key={s.id}>{s.label}</option>)}
        </select>
        <div className="lab-kv"><span>Device ID</span><strong>{scenario?.device_id || '—'}</strong></div>
        <div className="lab-kv"><span>Log type</span><strong>{scenario?.log_type || '—'}</strong></div>
        <div className="lab-kv"><span>Log lines</span><strong>{scenario?.lines?.length ?? '—'}</strong></div>
        <pre className="lab-logs">{scenario?.lines?.join('\n') || 'Loading sample logs…'}</pre>
        <button className="tp-button primary lab-submit" disabled={loading || !scenario} onClick={ingest}>
          {loading ? <LoaderCircle size={17} className="tp-spin"/> : <Send size={17}/>} {loading ? 'Ingesting…' : 'Ingest sample logs'}
        </button>
        {error && <p className="lab-error" role="alert">{error}</p>}
      </section>
      <section className="tp-card lab-card"><h2>2. Processing & evidence</h2><p>See what FastAPI actually stores and parses.</p>
        {!result ? <div className="lab-placeholder"><Database size={32}/><strong>No demo batch submitted yet</strong><span>Select a scenario and click “Ingest sample logs”.</span></div> : <>
          <div className="lab-success"><CheckCircle2 size={19}/> Batch {result.status}</div>
          <div className="lab-kv"><span>Device</span><strong>{result.device_id}</strong></div>
          <div className="lab-kv"><span>Batch ID</span><code>{result.batch_id}</code></div>
          <div className="lab-kv"><span>Lines received</span><strong>{result.line_count}</strong></div>
          <div className="lab-kv"><span>Received at</span><strong>{result.received_at}</strong></div>
          <div className="lab-hash"><Fingerprint size={16}/> <div><span>Recorded SHA-256</span><code>{result.sha256}</code></div></div>
          <h3>Parsed timeline events</h3>
          <div className="lab-events">{(result.events || []).map((e, i) => {
            const warnings = Array.isArray(e.parse_warnings) ? e.parse_warnings : [];
            const missing = Array.isArray(e.missing_fields) ? e.missing_fields : [];
            const partial = e.parse_status === 'partial' || warnings.length > 0 || missing.length > 0;
            return <div key={i} className="lab-event">
              <div className="lab-event-title"><strong>{e.event_type || 'Event'}</strong><span className={partial ? 'lab-parse-badge lab-parse-partial' : 'lab-parse-badge lab-parse-complete'}>{partial ? 'Partial parse' : 'Complete'}</span></div>
              <span>{e.severity || 'unknown'} · {e.username || 'Unknown user'}</span>
              {partial && <div className="lab-parse-detail" role="status">
                {warnings.map((warning, j) => <div key={j}>⚠ {warning}</div>)}
                {missing.length > 0 && <div>Missing fields: {missing.join(', ')}</div>}
              </div>}
              <small className="lab-raw-label">Original raw log</small>
              <small className="lab-raw-text">{e.raw_log ?? e.raw_line ?? scenario?.lines?.[i] ?? '—'}</small>
            </div>;
          })}</div>
          <p className="lab-footnote">The hash is recorded during ingestion. Use Evidence → Verify to independently recompute and compare it.</p>
          <button className="tp-button lab-submit" onClick={() => onViewTimeline?.()}><ArrowRight size={17}/> View event timeline</button>
        </>}
      </section>
    </div>
  </div>;
}

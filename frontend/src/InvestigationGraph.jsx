import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, AlertTriangle, ArrowRight, Fingerprint, GitBranch, RefreshCw, ShieldAlert } from 'lucide-react';
import './InvestigationGraph.css';
import { useEvidenceTrustScores, TrustScoreDetails } from './EvidenceTrustScore'; // GRAPH_TRUST_SCORE_V1

export default function InvestigationGraph() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const { scores: trustScores, scoreError: trustScoreError } = useEvidenceTrustScores();
  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/v1/graph', { credentials: 'same-origin' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.detail === 'string' ? body.detail : `Unable to load graph (${response.status})`);
      }
      const body = await response.json();
      setData({ nodes: Array.isArray(body.nodes) ? body.nodes : [], edges: Array.isArray(body.edges) ? body.edges : [], truncated: !!body.truncated });
    } catch (err) {
      setError(err.message || 'Unable to load graph');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);
  const nodes = data?.nodes || [];
  const edges = data?.edges || [];
  const lookup = useMemo(() => new Map(nodes.map(node => [node.id, node])), [data]);
  const connected = useMemo(() => new Set(edges.flatMap(edge => [edge.source, edge.target])), [data]);
  const gaps = nodes.filter(node => node.parse_status === 'partial' || !node.timestamp_utc);
  return <section className="tp-graph-root tp-graph-phase5">
    <div className="tp-graph-intro tp-card tp-graph-phase5-hero"><div><h2><GitBranch size={19}/> Investigation Graph</h2><p>Explainable correlations between collected security events. Each node references a stored evidence batch and line.</p></div><button className="tp-button" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? 'tp-spin' : ''}/> Refresh graph</button></div>
    {error && <div className="tp-error" role="alert">{error}</div>}
    <div className="tp-graph-stats"><div className="tp-card"><Activity size={19}/><strong>{nodes.length}</strong><span>Evidence-linked events</span></div><div className="tp-card"><GitBranch size={19}/><strong>{edges.length}</strong><span>Potential connections</span></div><div className="tp-card"><AlertTriangle size={19}/><strong>{gaps.length}</strong><span>Parsing or timestamp gaps</span></div></div>
    <div className="tp-card tp-graph-panel tp-graph-phase5-panel"><div className="tp-graph-panel-head"><div><h3>Authentication sequences</h3><p>Failed logins followed by successful logins for the same username within 30 minutes.</p></div><span className="tp-graph-legend"><i/> Tentative cross-device link</span></div>
      {!loading && !edges.length && <div className="tp-graph-empty"><ShieldAlert size={29}/><strong>No correlated authentication sequences found</strong><p>Try ingesting a sequence of failed and successful logins for the same user with valid timestamps.</p></div>}
      <div className="tp-graph-sequences">{edges.map((edge, index) => {
        const source = lookup.get(edge.source), target = lookup.get(edge.target);
        if (!source || !target) return null;
        return <div className="tp-graph-sequence" key={`${edge.source}-${edge.target}-${index}`}>
          <button className="tp-graph-node failure" onClick={() => setSelected(source)}><span>Failed authentication</span><strong>{source.username || 'Unknown user'}</strong><small>{source.device_id} · {source.timestamp_utc || source.timestamp}</small></button>
          <div className={`tp-graph-edge ${edge.confidence === 'tentative' ? 'tentative' : ''}`} title={edge.reason}><ArrowRight size={21}/><span>{edge.confidence === 'tentative' ? 'Tentative' : 'Same device'}</span></div>
          <button className="tp-graph-node success" onClick={() => setSelected(target)}><span>Successful login</span><strong>{target.username || 'Unknown user'}</strong><small>{target.device_id} · {target.timestamp_utc || target.timestamp}</small></button>
          <p className="tp-graph-reason">{edge.reason}</p>
        </div>;
      })}</div>
    </div>
    <div className="tp-card tp-graph-gaps tp-graph-phase5-gaps"><h3><AlertTriangle size={17}/> Evidence requiring review</h3><p>Incomplete or un-timestamped events are preserved but cannot establish reliable temporal connections.</p>{gaps.length ? gaps.slice(0, 12).map(node => <button key={node.id} onClick={() => setSelected(node)}><span>{node.device_id} · line {node.line_number}</span><small>{(node.parse_warnings || []).join(', ') || 'Timestamp unavailable'}</small><ArrowRight size={15}/></button>) : <div className="tp-graph-no-gaps">No parsing or timestamp gaps among loaded events.</div>}</div>
    {data?.truncated && <p className="tp-graph-caution">Graph limited to the first 1,500 timeline events. Results are not exhaustive.</p>}
    <p className="tp-graph-caution">Correlations are investigative leads, not proof of compromise. No AI is used.</p>
    {selected && createPortal(<div className="tp-overlay" onMouseDown={() => setSelected(null)}><aside className="tp-drawer" role="dialog" aria-modal="true" aria-label="Graph event details" onMouseDown={e => e.stopPropagation()}><div className="tp-drawer-header"><div><span>Evidence-linked event</span><h2>{(selected.event_type || 'Unknown event').replaceAll('_', ' ')}</h2></div><button onClick={() => setSelected(null)} aria-label="Close details">✕</button></div><div className="tp-drawer-body"><h3><Fingerprint size={16}/> Evidence reference</h3>{[['Device', selected.device_id], ['Batch ID', selected.batch_id], ['Line number', selected.line_number], ['UTC timestamp', selected.timestamp_utc || 'Unavailable'], ['Username', selected.username || 'Unavailable'], ['Parse status', selected.parse_status || 'Unknown']].map(([label, value]) => <div className="tp-detail" key={label}><span>{label}</span><strong>{value}</strong></div>)}<TrustScoreDetails
      result={trustScores[`${selected.device_id}/${selected.batch_id}`]}
      error={trustScoreError}
    /><h3>Original log</h3><pre>{selected.raw_log || 'No raw log available'}</pre>{selected.parse_warnings?.length > 0 && <p className="tp-graph-caution">Warnings: {selected.parse_warnings.join('; ')}</p>}</div></aside></div>, document.body)}
  </section>;
}

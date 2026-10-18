// TRACEPOINT_SHADCN_PHASE2
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from './components/ui/table';
// TRACEPOINT_SHADCN_PHASE1
import { Card } from './components/ui/card';
import InvestigationGraph from './InvestigationGraph';
import Reports from './reports';
import Investigations from './Investigations';
import EvidenceLibrary from "./EvidenceLibrary";
import LogIngestionLab from './LogIngestionLab';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wifi, WifiOff, Activity, ArrowDownToLine, ChevronRight, CircleHelp, Clock3, FileClock, FileText, Fingerprint, LayoutDashboard, LogOut, Menu, RefreshCw, Search, ShieldAlert, SlidersHorizontal, Terminal, X, GitBranch } from 'lucide-react';
import './Tracepoint.css';


const navigation = [
  ['overview', 'Overview', LayoutDashboard],
  ['timeline', 'Event timeline', Activity],
  ['ingestion', 'Log Ingestion Lab', Terminal],
  ['evidence', 'Evidence', Fingerprint],
  ['investigations', 'Investigations', ShieldAlert],
  ['graph', 'Investigation Graph', GitBranch],
  ['reports', 'Reports', FileText],
];
const text = value => value === undefined || value === null || value === '' ? '—' : String(value);
const timestamp = e => e.timestamp || e.event_timestamp || e.time || e.received_at || e.datetime || '';
const eventType = e => text(e.event_type || e.type || e.action || 'Event').replaceAll('_', ' ');
const severity = e => text(e.severity || e.level || 'unknown').toLowerCase();
const device = e => text(e.device_id || e.hostname || e.device || e.host);
const message = e => text(e.message || e.raw_line || e.raw || e.description || e.details || eventType(e));
const dateLabel = value => { const d = new Date(value); return value && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : text(value); };
const fullDate = value => { const d = new Date(value); return value && !Number.isNaN(d.getTime()) ? d.toLocaleString() : text(value); };
const unpack = data => Array.isArray(data) ? data : (data?.events || data?.timeline || data?.items || data?.data?.events || []);
const csvValue = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
const fail = e => /fail|denied|invalid|reject/i.test([eventType(e), message(e)].join(' '));
const severityClass = value => `sev-${value.replace(/[^a-z]/g, '')}`;

function TrendChart({ events }) {
  const buckets = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(today); day.setDate(today.getDate() - (6 - index));
      const next = new Date(day); next.setDate(day.getDate() + 1);
      const current = events.filter(e => { const time = Date.parse(timestamp(e)); return time >= day.getTime() && time < next.getTime(); });
      return { label: day.toLocaleDateString(undefined, { weekday: 'short' }), total: current.length, failures: current.filter(fail).length };
    });
  }, [events]);
  const max = Math.max(1, ...buckets.map(b => b.total));
  return <section className="tp-card tp-chart-card"><div className="tp-card-head"><div><h2>Event activity</h2><p>Collected events over the last 7 days</p></div><span className="tp-period">Last 7 days</span></div><div className="tp-chart"><div className="tp-chart-lines"><span>{max}</span><span>{Math.round(max / 2)}</span><span>0</span></div><div className="tp-bars">{buckets.map((b, i) => <div className="tp-bar-column" key={i} title={`${b.label}: ${b.total} events, ${b.failures} failures`}><div className="tp-bar-track"><div className="tp-bar-stack" style={{ height: `${b.total ? Math.max(5, b.total / max * 100) : 0}%` }}><div className="tp-bar-failure" style={{ height: `${b.total ? b.failures / b.total * 100 : 0}%` }} /></div></div><span>{b.label}</span></div>)}</div></div><div className="tp-legend"><span><i className="tp-key-purple"/> Other events</span><span><i className="tp-key-orange"/> Authentication failures</span></div></section>;
}
function SeverityCard({ events }) {
  const groups = ['critical', 'high', 'medium', 'warning', 'low', 'info', 'unknown'];
  const counts = groups.map(name => ({ name, count: events.filter(e => severity(e) === name || (name === 'info' && severity(e) === 'informational')).length }));
  const max = Math.max(1, ...counts.map(c => c.count));
  return <section className="tp-card tp-distribution"><div className="tp-card-head"><div><h2>Severity breakdown</h2><p>Classification of collected events</p></div></div><div className="tp-severity-list">{counts.map(c => <div className="tp-severity-row" key={c.name}><span className={`tp-sev-dot ${severityClass(c.name)}`}/><span className="tp-sev-label">{c.name}</span><div className="tp-sev-track"><div className={`tp-sev-fill ${severityClass(c.name)}`} style={{ width: `${c.count / max * 100}%` }}/></div><strong>{c.count}</strong></div>)}</div><div className="tp-distribution-foot">Based on event severity fields received from the agent</div></section>;
}
function Metric({ label, value, note, icon: Icon }) { return <Card className="tp-metric"><div className="tp-metric-label">{label}<Icon size={17}/></div><strong>{value}</strong><span>{note}</span></Card>; }
// TRACEPOINT_EVENT_TABLE_REDESIGN_V1
const eventIcon = e => {
  const name = eventType(e).toLowerCase();
  if (/fail|denied|invalid|reject/.test(name)) return ShieldAlert;
  if (/login|auth|session|access/.test(name)) return Fingerprint;
  if (/error|critical|alert/.test(name)) return ShieldAlert;
  return Activity;
};
const eventDateParts = value => {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return { date: text(value), time: '' };
  return {
    date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  };
};
function EventTable({ rows, loading, onSelect }) {
  return <div className="tp-table-scroll tp-event-table-redesign">
    <Table className="tp-table tp-forensic-table">
      <TableHeader><TableRow>
        <TableHead>Event</TableHead><TableHead>Source device</TableHead>
        <TableHead>User</TableHead><TableHead>Severity</TableHead>
        <TableHead>Timestamp</TableHead><TableHead aria-label="Inspect event" />
      </TableRow></TableHeader>
      <TableBody>{rows.map((e, i) => {
        const Icon = eventIcon(e);
        const when = eventDateParts(timestamp(e));
        const level = severity(e);
        return <TableRow
          key={`${e.id || e.event_id || timestamp(e)}-${i}`}
          onClick={() => onSelect(e)}
          onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(e); } }}
          tabIndex={0} role="button" aria-label={`Inspect ${eventType(e)} event`}
        >
          <TableCell className="tp-event-cell">
            <div className="tp-forensic-event-identity">
              <span className={`tp-forensic-event-icon ${fail(e) ? 'is-failure' : ''}`} aria-hidden="true"><Icon size={18}/></span>
              <span className="tp-forensic-event-text">
                <strong>{eventType(e)}</strong>
                <small title={message(e)}>{message(e)}</small>
              </span>
            </div>
          </TableCell>
          <TableCell><code className="tp-forensic-device">{device(e)}</code></TableCell>
          <TableCell><span className="tp-forensic-username">{text(e.username)}</span></TableCell>
          <TableCell><Badge variant="outline" className={`tp-severity ${severityClass(level)}`}>{level}</Badge></TableCell>
          <TableCell><time className="tp-forensic-event-time" dateTime={timestamp(e) || undefined}>
            <span>{when.date}</span>{when.time && <small>{when.time}</small>}
          </time></TableCell>
          <TableCell className="tp-forensic-open-cell"><ChevronRight size={17} aria-hidden="true"/></TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>
    {loading && <div className="tp-empty">Loading events…</div>}
    {!loading && !rows.length && <div className="tp-empty">No events to display. Check your agent connection or adjust the filters.</div>}
  </div>;
}

export default function Dashboard({ user, onSignOut }) {
  // TRACEPOINT_PAGE_PERSIST_V1: remember the selected page for this tab.
  const [page, setPage] = useState(() => {
    try {
      const saved = window.sessionStorage.getItem('tracepoint.activePage');
      return navigation.some(([id]) => id === saved) ? saved : 'overview';
    } catch {
      return 'overview';
    }
  });
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('all');
  const [selected, setSelected] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [evidenceRefresh, setEvidenceRefresh] = useState(0);
  // TRACEPOINT_NAV_V2_STATUS: real API health check, every 30 seconds.
  const [apiStatus, setApiStatus] = useState('checking');
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch('/health', { cache: 'no-store' });
        if (active) setApiStatus(response.ok ? 'online' : 'offline');
      } catch { if (active) setApiStatus('offline'); }
    };
    check();
    const timer = setInterval(check, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/v1/timeline', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(response.status === 401 ? 'Your session has expired. Sign out and sign in again.' : `Unable to load events (HTTP ${response.status}).`);
      setEvents(unpack(await response.json()));
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const sorted = useMemo(() => [...events].sort((a, b) => (Date.parse(timestamp(b)) || 0) - (Date.parse(timestamp(a)) || 0)), [events]);
  const levels = useMemo(() => [...new Set(events.map(severity))].sort(), [events]);
  const filtered = useMemo(() => sorted.filter(e => (level === 'all' || severity(e) === level) && [eventType(e), device(e), message(e), e.username, timestamp(e)].some(v => text(v).toLowerCase().includes(search.trim().toLowerCase()))), [sorted, level, search]);
  // TRACEPOINT_OVERVIEW_REDESIGN_V1: all signals are derived from actual timeline events.
  const parsingIssues = events.filter(e => e.parse_status && !['parsed', 'success', 'ok', 'complete'].includes(String(e.parse_status).toLowerCase()) || Number(e.parse_gap_count || 0) > 0).length;
  const timestampIssues = events.filter(e => e.timestamp_conflict === true || e.timestamp_inferred === true).length;
  const affectedDevices = new Set(events.filter(fail).map(device).filter(d => d !== '—')).size;
  const failures = events.filter(fail).length;
  const devices = new Set(events.map(device).filter(d => d !== '—')).size;
  const users = new Set(events.map(e => e.username).filter(Boolean)).size;
  const title = navigation.find(item => item[0] === page)?.[1] || 'Overview';
  function exportCsv() {
    const rows = [['timestamp', 'event_type', 'severity', 'device_id', 'username', 'message'], ...filtered.map(e => [timestamp(e), eventType(e), severity(e), device(e), e.username || '', message(e)])];
    const csv = '\ufeff' + rows.map(row => row.map(csvValue).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'tracepoint-events.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const openPage = id => {
    setPage(id);
    try { window.sessionStorage.setItem('tracepoint.activePage', id); } catch { /* storage unavailable */ }
    setSelected(null);
    setMobileOpen(false);
  };
  return <div className="tp-app">
    <aside className={`tp-sidebar ${mobileOpen ? 'tp-open' : ''}`}>
      <div className="tp-brand"><svg className="tp-brand-mark" viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M8 9H17L26 18V27H17L8 18V9Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M8 18H17M17 9V18M17 18L26 27" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="8" cy="9" r="2.7" fill="currentColor"/><circle cx="17" cy="18" r="3" fill="currentColor"/><circle cx="26" cy="27" r="2.7" fill="currentColor"/></svg><span className="tp-brand-word">tracepoint<span>.</span></span></div>
      <div className="tp-workspace"><span className="tp-workspace-avatar">TP</span><div><strong>Security workspace</strong><small>Evidence & investigations</small></div></div>
      <div className="tp-nav-label">Workspace</div>
      <nav aria-label="Main navigation">{navigation.map(([id, label, Icon]) => <button key={id} className={`tp-nav-item ${page === id ? 'active' : ''}`} onClick={() => openPage(id)}><Icon size={18}/><span>{label}</span>{page === id && <ChevronRight size={15} className="tp-nav-chevron"/>}</button>)}</nav>
      <div className="tp-sidebar-bottom">
      <div className="tp-topbar-right">
        <div className={`tp-api-pill ${apiStatus}`} title={`Backend connection: ${apiStatus}`} role="status">
          {apiStatus === 'offline' ? <WifiOff size={14}/> : <Wifi size={14}/>}
          <span>{apiStatus === 'online' ? 'API connected' : apiStatus === 'offline' ? 'API offline' : 'Connecting…'}</span>
        </div>
        <span className="tp-topbar-divider" aria-hidden="true"/>
        <div className="tp-topbar-account"><span className="tp-topbar-user">{user?.name || 'Account'}</span><small>Analyst workspace</small></div>
        <span className="tp-topbar-avatar">{(user?.name || 'U')[0].toUpperCase()}</span>
      </div><div className="tp-profile"><span className="tp-profile-avatar">{(user?.name || 'U')[0].toUpperCase()}</span><div><strong>{user?.name || 'Account'}</strong><small>{user?.email || ''}</small></div></div><button className="tp-signout" onClick={onSignOut}><LogOut size={17}/> Sign out</button></div>
    </aside>
    <main className="tp-main">
    {/* TRACEPOINT_SINGLE_NAV_V1: status and account live in primary navigation */}

      <div className="tp-content"><div className="tp-page-header"><div><h1>{title}</h1><p>{page === 'overview' ? 'Security activity and collected evidence across your workspace.' : page === 'timeline' ? 'Explore, filter and inspect security events.' : page === 'ingestion' ? 'Explore sample logs and follow them through the ingestion pipeline.' : page === 'evidence' ? 'Evidence collection and integrity records.' : page === 'graph' ? 'Explore evidence-linked authentication sequences.' : page === 'investigations' ? 'Review events and prepare incident investigations.' : 'Export collected security activity.'}</p></div><div className="tp-actions"><Button variant="outline" className="tp-button" onClick={() => {
  if (page === 'evidence') {
    setEvidenceRefresh(value => value + 1);
  } else {
    refresh();
  }
}} disabled={loading}><RefreshCw size={16} className={loading ? 'tp-spin' : ''}/> Refresh</Button>{page === 'timeline' && <Button className="tp-button primary" onClick={exportCsv}><ArrowDownToLine size={16}/> Export CSV</Button>}</div></div>
      {error && <div className="tp-error" role="alert">{error}</div>}
      {page === 'overview' && <>
      <div className="tp-forensic-intro">
        <div className="tp-forensic-intro-copy">
          <span className="tp-forensic-kicker"><Activity size={14}/> LIVE EVIDENCE OVERVIEW</span>
          <strong>Follow the signal. Verify the evidence.</strong>
          <p>Operational summary of collected security events. Open any record to inspect its source and raw data.</p>
        </div>
        <div className="tp-forensic-intro-side">
          <span>COLLECTION STATUS</span>
          <strong><span className="tp-forensic-status-dot"/> {loading ? 'Loading events' : `${events.length} events indexed`}</strong>
          <small>Based on the current event timeline</small>
        </div>
      </div>
      <div className="tp-metrics tp-forensic-metrics">
        <Metric label="Collected events" value={loading ? '…' : events.length.toLocaleString()} note="Available for inspection" icon={Activity}/>
        <Metric label="Authentication failures" value={loading ? '…' : failures.toLocaleString()} note={`${affectedDevices} source ${affectedDevices === 1 ? 'device' : 'devices'} affected`} icon={ShieldAlert}/>
        <Metric label="Source devices" value={loading ? '…' : devices} note="Unique device identifiers" icon={Fingerprint}/>
        <Metric label="Users observed" value={loading ? '…' : users} note="Unique usernames" icon={FileClock}/>
      </div>
      <div className="tp-forensic-section-title"><div><span className="tp-forensic-section-index">01 / ACTIVITY</span><h2>Event analysis</h2></div><span>Last 7 days · current collection</span></div>
      <div className="tp-analytics tp-forensic-analytics"><TrendChart events={events}/><SeverityCard events={events}/></div>
      <div className="tp-forensic-review">
        <div className="tp-forensic-review-title"><ShieldAlert size={18}/><div><strong>Data quality signals</strong><span>Indicators detected in collected events, not verified incidents</span></div></div>
        <div className="tp-forensic-review-items">
          <div><strong>{loading ? '…' : parsingIssues}</strong><span>Events with parsing gaps</span></div>
          <div><strong>{loading ? '…' : timestampIssues}</strong><span>Inferred or conflicting timestamps</span></div>
          <div><strong>{loading ? '…' : failures}</strong><span>Events matching failure indicators</span></div>
        </div>
      </div>
      <div className="tp-forensic-section-title"><div><span className="tp-forensic-section-index">02 / EVIDENCE</span><h2>Recent security events</h2></div><button className="tp-forensic-all-events" onClick={() => openPage('timeline')}>Open event explorer <ChevronRight size={16}/></button></div>
      <section className="tp-card tp-events-card tp-forensic-events"><EventTable rows={sorted.slice(0, 6)} loading={loading} onSelect={setSelected}/></section>
    </>}
    {/* TRACEPOINT_TIMELINE_WORKSPACE_V1 */}
    {page === 'timeline' && <div className="tp-timeline-workspace">
      <div className="tp-timeline-summary" aria-label="Timeline summary">
        <div><span>EVENTS IN VIEW</span><strong>{filtered.length.toLocaleString()}</strong><small>of {events.length.toLocaleString()} collected</small></div>
        <div><span>AUTHENTICATION FAILURES</span><strong>{filtered.filter(fail).length.toLocaleString()}</strong><small>matching failure indicators</small></div>
        <div><span>SOURCE DEVICES</span><strong>{new Set(filtered.map(device).filter(d => d !== '—')).size}</strong><small>in the current results</small></div>
        <div className="tp-timeline-summary-note"><ShieldAlert size={18}/><span>Events are investigative leads, not verified incidents. Select a row to inspect its raw evidence.</span></div>
      </div>
      <section className="tp-card tp-events-card tp-timeline-panel">
        <div className="tp-timeline-panel-head">
          <div><span className="tp-timeline-eyebrow">EVENT EXPLORER</span><h2>Collected event records</h2><p>Search the timeline and inspect individual source records.</p></div>
          <span className="tp-timeline-result-count">{filtered.length} results</span>
        </div>
        <div className="tp-timeline-controls">
          <label className="tp-timeline-search"><Search size={18}/><input aria-label="Search events" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search events, devices, users or log content"/></label>
          <label className="tp-timeline-select"><SlidersHorizontal size={17}/><select aria-label="Filter by severity" value={level} onChange={e => setLevel(e.target.value)}><option value="all">All severities</option>{levels.map(v => <option value={v} key={v}>{v}</option>)}</select></label>
          {(search || level !== 'all') && <Button variant="ghost" className="tp-timeline-clear" onClick={() => { setSearch(''); setLevel('all'); }}>Clear filters</Button>}
        </div>
        <div className="tp-timeline-table-caption"><span>Showing {filtered.length} matching events</span><span>Newest first · Click any row to inspect</span></div>
        <EventTable rows={filtered} loading={loading} onSelect={setSelected}/>
      </section>
    </div>}
    {page === 'evidence' && (
  <EvidenceLibrary refreshSignal={evidenceRefresh} />
)}
      {page === 'ingestion' && <LogIngestionLab onIngested={() => { refresh(); setEvidenceRefresh(v => v + 1); }} onViewTimeline={() => openPage('timeline')} />}
      {page === 'investigations' && <Investigations events={events} />}
      {page === 'graph' && <InvestigationGraph />}
      {page === 'reports' && <Reports onExportCsv={exportCsv} />}
      </div>
    </main>
    {selected && <div className="tp-overlay" onMouseDown={() => setSelected(null)}><aside className="tp-drawer" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Event details"><div className="tp-drawer-header"><div><span>Event inspection</span><h2>{eventType(selected)}</h2><div className={`tp-severity ${severityClass(severity(selected))}`}>{severity(selected)}</div></div><button onClick={() => setSelected(null)} aria-label="Close event details"><X size={21}/></button></div><div className="tp-drawer-body"><h3>Event information</h3>{[['Timestamp', fullDate(timestamp(selected))], ['Source device', device(selected)], ['Username', selected.username], ['Event type', eventType(selected)], ['Severity', severity(selected)], ['Message', message(selected)]].map(([label, value]) => <div className="tp-detail" key={label}><span>{label}</span><strong>{text(value)}</strong></div>)}<h3>Raw event data</h3><pre>{JSON.stringify(selected, null, 2)}</pre></div></aside></div>}
  </div>;
}

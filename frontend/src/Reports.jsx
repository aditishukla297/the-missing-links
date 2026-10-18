// TRACEPOINT_REPORTS_PHASE6

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine, FileText, Search, RefreshCw,
  ShieldCheck, AlertCircle
} from 'lucide-react';
import './Reports.css';

const API = '/api/v1/investigations';

export default function Reports({ onExportCsv }) {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');

  async function loadReports() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(API, {
        credentials: 'same-origin'
      });

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const data = await response.json();
      setCases(data.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReports();
  }, []);

  const filtered = useMemo(() => {
    return cases.filter(item => {
      const matchesSearch = [
        `TP-${String(item.id).padStart(4, '0')}`,
        item.title,
        item.description
      ].join(' ').toLowerCase().includes(search.toLowerCase());

      const matchesStatus =
        status === 'all' || item.status === status;

      return matchesSearch && matchesStatus;
    });
  }, [cases, search, status]);

  const downloadPdf = id => {
    window.open(`${API}/${id}/report`, '_blank');
  };

  return (
    <div className="tr-reports tr-reports-phase6">
      <div className="tr-reports-intro tr-report-hero">
        <div>
          <span className="tr-report-eyebrow"><FileText size={14} /> FORENSIC REPORTING / CASE ARCHIVE</span>
          <h2>Investigation reports, ready for review.</h2>
          <p>
            Generate forensic investigation reports and
            export collected timeline events.
          </p>
        </div>

      <div className="tr-report-hero-aside"><span>CASE REPORTS</span><strong>{loading ? "Loading…" : `${cases.length} available`}</strong><small>PDF reports generated on request</small></div>
    </div>

      <div className="tr-report-stats">
        <div className="tr-report-stat">
          <FileText size={20} />
          <span>Total investigations</span>
          <strong>{cases.length}</strong>
        </div>

        <div className="tr-report-stat">
          <ShieldCheck size={20} />
          <span>Resolved cases</span>
          <strong>
            {cases.filter(c => c.status === 'resolved').length}
          </strong>
        </div>

        <div className="tr-report-stat">
          <AlertCircle size={20} />
          <span>Linked events</span>
          <strong>
            {cases.reduce((sum, c) => sum + (c.event_count || 0), 0)}
          </strong>
        </div>
      </div>

      <div className="tr-report-panel">
      <div className="tr-report-panel-heading"><div><h3>Case report register</h3><p>{filtered.length} of {cases.length} investigations</p></div><button type="button" className="tp-button tr-report-refresh" onClick={loadReports} disabled={loading}><RefreshCw size={15} className={loading ? "tp-spin" : ""} /> Refresh</button></div>
        <div className="tr-report-toolbar">
          <div className="tr-report-search">
            <Search size={17} />
            <input aria-label="Search investigation reports"
              placeholder="Search case ID or title..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <select aria-label="Filter reports by status"
            value={status}
            onChange={e => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>

        {error && <p className="tr-report-error">{error}</p>}

        {loading ? (
          <div className="tr-report-empty">Loading investigations...</div>
        ) : filtered.length === 0 ? (
          <div className="tr-report-empty">
            No investigations found.
          </div>
        ) : (
          <div className="tr-report-list" role="list" aria-label="Investigation reports">
            {filtered.map(item => (
              <div className="tr-report-row" role="listitem" key={item.id}>
                <div className="tr-report-case">
                  <span className="tr-report-id">
                    TP-{String(item.id).padStart(4, '0')}
                  </span>

                  <strong>{item.title}</strong>

                  <span className="tr-report-details">
                    {item.event_count || 0} linked events
                    {' · '}
                    {item.note_count || 0} analyst notes
                  </span>
                </div>

                <div className="tr-report-tags">
                  <span className={`tr-report-tag ${item.severity}`}>
                    {item.severity}
                  </span>

                  <span className="tr-report-tag">
                    {item.status}
                  </span>
                </div>

                <button
                  className="tp-button primary"
                  onClick={() => downloadPdf(item.id)}
                >
                  <ArrowDownToLine size={16} />
                  Download PDF
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="tr-report-export">
        <div>
          <h3>Timeline CSV export</h3>
          <p>
            Export collected timeline events for offline analysis.
            CSV exports are not signed forensic reports.
          </p>
        </div>

        <button className="tp-button" onClick={onExportCsv} disabled={typeof onExportCsv !== "function"}>
          <ArrowDownToLine size={16} />
          Download CSV
        </button>
      </div>
    </div>
  );
}

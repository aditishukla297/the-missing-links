// TRACEPOINT_EVIDENCE_PHASE4

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Fingerprint,
  Search,
  ShieldCheck,
  LoaderCircle,
  X,
  Copy,
} from "lucide-react";
import "./Tracepoint.css";
// TRACEPOINT_TRUST_SCORE_V1
import { useEvidenceTrustScores, TrustScoreBadge, TrustScoreDetails } from "./EvidenceTrustScore";

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const shortHash = (value) =>
  value ? `${value.slice(0, 16)}…${value.slice(-8)}` : "—";

export default function EvidenceLibrary({ refreshSignal = 0 }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState({});
  const [verifying, setVerifying] = useState(null);
  const { scores, scoreError } = useEvidenceTrustScores(refreshSignal);

  const keyFor = (batch) => `${batch.device_id}/${batch.batch_id}`;

  async function loadEvidence() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/v1/evidence", {
        credentials: "same-origin",
      });

      if (!response.ok) throw new Error("Unable to load evidence records.");

      const data = await response.json();
      setBatches(data.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEvidence();
  }, [refreshSignal]);

  async function verify(batch) {
    const key = keyFor(batch);
    setVerifying(key);

    try {
      const response = await fetch(
        `/api/v1/evidence/${encodeURIComponent(batch.device_id)}/${encodeURIComponent(batch.batch_id)}/verify`,
        {
          method: "POST",
          credentials: "same-origin",
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Verification failed.");
      }

      setResults((previous) => ({
        ...previous,
        [key]: result,
      }));
    } catch (err) {
      setResults((previous) => ({
        ...previous,
        [key]: {
          status: "error",
          verified: false,
          detail: err.message,
        },
      }));
    } finally {
      setVerifying(null);
    }
  }

  const filtered = batches.filter((batch) =>
    [
      batch.device_id,
      batch.batch_id,
      batch.log_type,
      batch.sha256,
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const totalLines = batches.reduce(
    (sum, batch) => sum + (Number(batch.line_count) || 0),
    0
  );

  const verifiedCount = batches.filter(
    (batch) => results[keyFor(batch)]?.verified === true
  ).length;

  function statusFor(batch) {
    const key = keyFor(batch);
    const result = results[key];

    if (verifying === key) {
      return <span className="tp-ev-status pending">Checking…</span>;
    }

    if (!result) {
      return <span className="tp-ev-status neutral">Not checked</span>;
    }

    if (result.verified) {
      return (
        <span className="tp-ev-status success">
          <CheckCircle2 size={14} /> Verified
        </span>
      );
    }

    return (
      <span className="tp-ev-status danger">
        <XCircle size={14} /> {result.status === "mismatch" ? "Mismatch" : "Failed"}
      </span>
    );
  }

  return (
    <div className="tp-ev tp-evidence-console">
      <section className="tp-evidence-banner">
        <div><span className="tp-evidence-eyebrow">EVIDENCE / COLLECTION REGISTER</span>
          <h2>Collected evidence, accounted for.</h2>
          <p>Review collection metadata, verify SHA-256 fingerprints and inspect trust assessments.</p>
        </div>
        <div className="tp-evidence-banner-side"><span>COLLECTION REGISTER</span>
          <strong>{loading ? 'Loading…' : `${batches.length} batches`}</strong>
          <small>Integrity checks run on demand</small>
        </div>
      </section>
      <div className="tp-ev-stats tp-evidence-stats">
        <div className="tp-card tp-ev-stat">
          <span>Evidence batches</span>
          <strong>{batches.length}</strong>
          <small>Stored collection batches</small>
        </div>
        <div className="tp-card tp-ev-stat">
          <span>Evidence records</span>
          <strong>{totalLines}</strong>
          <small>Collected log lines</small>
        </div>
        <div className="tp-card tp-ev-stat">
          <span>Verified this session</span>
          <strong>{verifiedCount}</strong>
          <small>Passed SHA-256 comparison</small>
        </div>
      </div>

      <section className="tp-card tp-ev-card tp-evidence-register">
        <div className="tp-card-head">
          <div>
            <h2>Collection register</h2>
            <p>Stored batches, source devices and verification results</p>
          </div>
        </div>

        <div className="tp-toolbar">
          <label className="tp-search">
            <Search size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search device, batch ID or SHA-256"
              aria-label="Search evidence"
            />
          </label>
        </div>

        {error && <div className="tp-error">{error}</div>}

        {loading ? (
          <div className="tp-ev-empty">
            <LoaderCircle size={22} className="tp-spin" /> Loading evidence…
          </div>
        ) : filtered.length === 0 ? (
          <div className="tp-ev-empty">No matching evidence batches found.</div>
        ) : (
          <div className="tp-ev-table-wrap">
            <table className="tp-ev-table tp-evidence-table">
              <thead>
                <tr>
                  <th>Evidence batch</th>
                  <th>Device</th>
                  <th>Records</th>
                  <th>Collected</th>
                  <th>Integrity</th>
                <th>Trust score</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((batch) => {
                  const key = keyFor(batch);

                  return (
                    <tr key={key}>
                      <td>
                        <button
                          className="tp-ev-batch-link tp-evidence-batch"
                          onClick={() => setSelected(batch)}
                        >
                          <Fingerprint size={17} />
                          <span>
                            <strong>{batch.batch_id?.slice(0, 12)}…</strong>
                            <small>{batch.log_type || "Unknown log type"}</small>
                          </span>
                        </button>
                      </td>
                      <td className="tp-evidence-device">{batch.device_id}</td>
                      <td>{batch.line_count}</td>
                      <td className="tp-evidence-date">{formatDate(batch.received_at)}</td>
                      <td>{statusFor(batch)}</td>
                    <td><TrustScoreBadge result={scores[key]} /></td>
                      <td>
                        <button
                          className="tp-button tp-ev-verify"
                          onClick={() => verify(batch)}
                          disabled={verifying === key}
                        >
                          <ShieldCheck size={15} />
                          {verifying === key ? "Checking" : "Verify"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <div className="tp-overlay" onMouseDown={() => setSelected(null)}>
          <aside
            className="tp-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Evidence batch details"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="tp-drawer-header">
              <div>
                <span>Evidence inspection</span>
                <h2>Batch details</h2>
                {statusFor(selected)}
              </div>
              <button
                onClick={() => setSelected(null)}
                aria-label="Close evidence details"
              >
                <X size={21} />
              </button>
            </div>

            <div className="tp-drawer-body">
              <h3>Collection metadata</h3>
              {[
                ["Batch ID", selected.batch_id],
                ["Source device", selected.device_id],
                ["Log type", selected.log_type],
                ["Records", selected.line_count],
                ["Received at", formatDate(selected.received_at)],
                ["Evidence file", selected.evidence_file],
              ].map(([label, value]) => (
                <div className="tp-detail" key={label}>
                  <span>{label}</span>
                  <strong>{value ?? "—"}</strong>
                </div>
              ))}

              <TrustScoreDetails result={scores[keyFor(selected)]} error={scoreError} />
            <h3>SHA-256 fingerprint</h3>
              <div className="tp-ev-hash">
                <code>{selected.sha256}</code>
                <button
                  aria-label="Copy SHA-256 hash"
                  title="Copy hash"
                  onClick={() => navigator.clipboard.writeText(selected.sha256)}
                >
                  <Copy size={17} />
                </button>
              </div>

              <button
                className="tp-button primary tp-ev-drawer-button"
                onClick={() => verify(selected)}
                disabled={verifying === keyFor(selected)}
              >
                <ShieldCheck size={17} />
                {verifying === keyFor(selected)
                  ? "Verifying…"
                  : "Verify integrity"}
              </button>

              {results[keyFor(selected)] && (
                <div className="tp-ev-result">
                  {results[keyFor(selected)].verified ? (
                    <CheckCircle2 size={19} />
                  ) : (
                    <AlertTriangle size={19} />
                  )}
                  <div>
                    <strong>
                      {results[keyFor(selected)].verified
                        ? "SHA-256 hashes match"
                        : "Integrity check did not pass"}
                    </strong>
                    <p>
                      {results[keyFor(selected)].verified
                        ? `Verified at ${formatDate(results[keyFor(selected)].verified_at)}`
                        : results[keyFor(selected)].detail ||
                          `Result: ${results[keyFor(selected)].status}`}
                    </p>
                    {results[keyFor(selected)].actual_sha256 && (
                      <p className="tp-ev-actual-hash">
                        Computed: {shortHash(results[keyFor(selected)].actual_sha256)}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

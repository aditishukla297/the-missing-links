import { useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import './EvidenceTrustScore.css';

export function useEvidenceTrustScores(refreshSignal = 0) {
  const [scores, setScores] = useState({});
  const [scoreError, setScoreError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/v1/evidence/trust-scores', { credentials: 'same-origin' })
      .then(async response => { if (!response.ok) throw new Error(`Trust score API returned ${response.status}`); return response.json(); })
      .then(data => { if (active) setScores(Object.fromEntries((data.items || []).map(item => [`${item.device_id}/${item.batch_id}`, item]))); })
      .catch(error => { if (active) setScoreError(error.message); });
    return () => { active = false; };
  }, [refreshSignal]);
  return { scores, scoreError };
}

export function TrustScoreBadge({ result }) {
  if (!result) return <span className="tp-trust-badge neutral">Not scored</span>;
  const danger = result.integrity !== 'verified';
  return <span className={`tp-trust-badge ${danger ? 'danger' : result.score >= 75 ? 'good' : 'warning'}`} title={result.rating}>
    {danger ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />}
    {result.score}/100 · {result.rating}
  </span>;
}

export function TrustScoreDetails({ result, error }) {
  if (!result) return <section className="tp-trust-details"><h3>Evidence Trust Score</h3><p>{error || 'Calculating evidence quality…'}</p></section>;
  return <section className="tp-trust-details">
    <h3>Evidence Trust Score</h3>
    <div className="tp-trust-summary"><strong>{result.score}<small>/100</small></strong><TrustScoreBadge result={result} /></div>
    <div className="tp-trust-track"><div style={{ width: `${result.score}%` }} /></div>
    <p className="tp-trust-integrity">Integrity: <strong>{result.integrity.replaceAll('_', ' ')}</strong></p>
    {(result.breakdown || []).map(item => <div className="tp-trust-row" key={item.name}>
      <div><strong>{item.name}</strong><small>{item.reason}</small></div><span>{item.earned}/{item.maximum}</span>
    </div>)}
    <p className="tp-trust-disclaimer">{result.note}</p>
  </section>;
}

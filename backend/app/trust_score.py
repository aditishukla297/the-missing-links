"""Evidence-quality scoring. SHA-256 consistency is not source authenticity."""
import hashlib
import hmac
import json
import re
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request
from app.auth import current_user
from app.parser import parse_log

router = APIRouter(prefix="/api/v1/evidence", tags=["evidence-quality"])
EVIDENCE_DIR = Path(__file__).resolve().parent.parent / "data" / "evidence"
SAFE_DEVICE = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
SAFE_BATCH = re.compile(r"[0-9a-fA-F-]{36}\Z")

def quality_for(device_id, batch_id):
    if not SAFE_DEVICE.fullmatch(device_id) or not SAFE_BATCH.fullmatch(batch_id):
        raise HTTPException(status_code=400, detail="Invalid evidence identifier")
    directory = EVIDENCE_DIR / device_id
    evidence_path = directory / (batch_id + ".json")
    metadata_path = directory / (batch_id + ".meta.json")
    if not metadata_path.is_file():
        raise HTTPException(status_code=404, detail="Evidence metadata not found")
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Unreadable evidence metadata")
    expected = metadata.get("sha256")
    valid_expected = isinstance(expected, str) and re.fullmatch(r"[0-9a-fA-F]{64}", expected)
    if not evidence_path.is_file():
        integrity = "missing"
        raw = None
    else:
        try:
            raw = evidence_path.read_bytes()
        except OSError:
            raise HTTPException(status_code=500, detail="Cannot read evidence")
        actual = hashlib.sha256(raw).hexdigest()
        integrity = ("verified" if hmac.compare_digest(actual, expected.lower()) else "mismatch") if valid_expected else "invalid_metadata"
    if integrity != "verified":
        return {"device_id":device_id,"batch_id":batch_id,"score":0,"rating":"Integrity alert", "integrity":integrity,"records":0,"breakdown":[{"name":"SHA-256 integrity","earned":0,"maximum":40,"reason":"Evidence missing, hash mismatch, or invalid hash metadata"},{"name":"Parsing completeness","earned":0,"maximum":25,"reason":"Not evaluated while integrity is unverified"},{"name":"Timestamp reliability","earned":0,"maximum":20,"reason":"Not evaluated while integrity is unverified"},{"name":"Required field coverage","earned":0,"maximum":15,"reason":"Not evaluated while integrity is unverified"}],"note":"A matching hash establishes consistency with stored metadata, not source authenticity."}
    try:
        batch = json.loads(raw)
        if not isinstance(batch, dict) or not isinstance(batch.get("lines"), list) or not batch["lines"] or any(not isinstance(line,str) for line in batch["lines"]):
            raise ValueError("Invalid batch lines")
        if batch.get("device_id") != device_id or str(batch.get("batch_id")) != batch_id:
            raise ValueError("Evidence identifiers disagree with storage location")
    except (ValueError, TypeError, UnicodeDecodeError):
        return {"device_id":device_id,"batch_id":batch_id,"score":0,"rating":"Unusable evidence","integrity":integrity,"records":0,"breakdown":[],"note":"Hash matches metadata, but the evidence payload cannot be parsed or has inconsistent identifiers."}
    events = [parse_log(line, device_id, batch_id, str(batch.get("log_type", "unknown")), received_at=metadata.get("received_at"),source_timezone=metadata.get("source_timezone") or batch.get("source_timezone") or "Asia/Kolkata") for line in batch["lines"]]
    count = len(events)
    complete = sum(e.get("parse_status") == "complete" for e in events)
    reliable = sum(bool(e.get("timestamp_utc")) and not e.get("timestamp_inferred") and not e.get("timestamp_conflict") for e in events)
    coverage = sum(sum(bool(e.get(field)) and e.get(field) != "unknown" for field in ("timestamp", "event_type", "log_format")) for e in events)
    parsing_points = round(25 * complete/count)
    time_points = round(20 * reliable/count)
    field_points = round(15 * coverage/(3*count))
    score = 40 + parsing_points + time_points + field_points
    breakdown = [
        {"name":"SHA-256 integrity","earned":40,"maximum":40,"reason":"Stored evidence matches the recorded SHA-256"},
        {"name":"Parsing completeness","earned":parsing_points,"maximum":25,"reason":f"{complete}/{count} records parsed without warnings"},
        {"name":"Timestamp reliability","earned":time_points,"maximum":20,"reason":f"{reliable}/{count} records have explicit, non-conflicting UTC timestamps"},
        {"name":"Required field coverage","earned":field_points,"maximum":15,"reason":f"{coverage}/{3*count} timestamp, event type and log format fields available"},
    ]
    return {"device_id":device_id,"batch_id":batch_id,"score":score,"rating":"Strong" if score>=90 else "Good" if score>=75 else "Needs review" if score>=50 else "Low quality","integrity":integrity,"records":count,"breakdown":breakdown,"note":"Quality heuristic only. SHA-256 consistency does not prove source authenticity."}

@router.get("/trust-scores")
def list_trust_scores(request: Request):
    if current_user(request) is None:
        raise HTTPException(status_code=401,detail="Sign in required")
    items=[]
    if EVIDENCE_DIR.is_dir():
        for path in sorted(EVIDENCE_DIR.glob("*/*.meta.json"))[:1000]:
            device_id=path.parent.name
            batch_id=path.name[:-len(".meta.json")]
            try:
                items.append(quality_for(device_id,batch_id))
            except HTTPException:
                continue
    return {"items":items,"total":len(items)}

@router.get("/{device_id}/{batch_id}/trust-score")
def get_trust_score(device_id: str,batch_id: str,request: Request):
    if current_user(request) is None:
        raise HTTPException(status_code=401,detail="Sign in required")
    return quality_for(device_id,batch_id)

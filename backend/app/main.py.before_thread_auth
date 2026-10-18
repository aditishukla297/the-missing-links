
import hashlib
import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID
from app.parser import parse_log

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

app = FastAPI(
    title="The Missing Links API",
    version="0.1.0",
    description="Incident timeline and evidence collection"
)

EVIDENCE_DIR = Path(__file__).resolve().parent.parent / "data" / "evidence"
MAX_BATCH_BYTES = 1024 * 1024  # 1 MiB
MAX_LOG_LINES = 1000


class LogBatch(BaseModel):
    device_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    batch_id: UUID
    log_type: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,32}$")
    lines: list[str] = Field(min_length=1, max_length=MAX_LOG_LINES)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "the-missing-links"
    }


@app.post("/api/v1/ingest", status_code=201)
async def ingest_logs(
    request: Request,
    x_api_key: str | None = Header(default=None)
):
    expected_key = os.getenv("AGENT_API_KEY")

    if not expected_key:
        raise HTTPException(
            status_code=503,
            detail="Agent authentication is not configured"
        )

    if not x_api_key or not secrets.compare_digest(
        x_api_key, expected_key
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid API key"
        )

    # Read with an explicit size limit.
    chunks = []
    total = 0

    async for chunk in request.stream():
        total += len(chunk)

        if total > MAX_BATCH_BYTES:
            raise HTTPException(
                status_code=413,
                detail="Batch exceeds 1 MiB"
            )

        chunks.append(chunk)

    raw_bytes = b"".join(chunks)

    try:
        payload = LogBatch.model_validate_json(raw_bytes)
    except (ValidationError, ValueError):
        raise HTTPException(
            status_code=422,
            detail="Invalid log batch"
        )

    sha256 = hashlib.sha256(raw_bytes).hexdigest()

    # One directory per registered source.
    device_dir = EVIDENCE_DIR / payload.device_id
    device_dir.mkdir(parents=True, exist_ok=True)

    batch_name = str(payload.batch_id)
    evidence_path = device_dir / f"{batch_name}.json"
    metadata_path = device_dir / f"{batch_name}.meta.json"

    # Exclusive creation prevents overwriting existing evidence.
    try:
        with evidence_path.open("xb") as file:
            file.write(raw_bytes)
            file.flush()
            os.fsync(file.fileno())
    except FileExistsError:
        existing_hash = hashlib.sha256(
            evidence_path.read_bytes()
        ).hexdigest()

        if existing_hash != sha256:
            raise HTTPException(
                status_code=409,
                detail="Batch ID already exists with different content"
            )

        return {
            "status": "duplicate",
            "batch_id": batch_name,
            "sha256": sha256
        }

    metadata = {
        "device_id": payload.device_id,
        "batch_id": batch_name,
        "log_type": payload.log_type,
        "line_count": len(payload.lines),
        "sha256": sha256,
        "received_at": datetime.now(timezone.utc).isoformat(),
        "evidence_file": evidence_path.name
    }

    with metadata_path.open("x", encoding="utf-8") as file:
        json.dump(metadata, file, indent=2)
        file.flush()
        os.fsync(file.fileno())

    return {
        "status": "accepted",
        **metadata
    }

@app.get("/api/v1/timeline")
def get_timeline(
    severity: str | None = None,
    device_id: str | None = None,
    event_type: str | None = None,
    username: str | None = None,
):
    events = []

    if not EVIDENCE_DIR.exists():
        return {"total": 0, "events": []}

    for evidence_path in EVIDENCE_DIR.glob("*/*.json"):
        if evidence_path.name.endswith(".meta.json"):
            continue

        try:
            with evidence_path.open("r", encoding="utf-8") as file:
                batch = json.load(file)

            metadata_path = evidence_path.with_name(
                evidence_path.stem + ".meta.json"
            )

            received_at = None
            if metadata_path.exists():
                metadata = json.loads(metadata_path.read_text())
                received_at = metadata.get("received_at")

            for line_number, line in enumerate(batch["lines"], start=1):
                event = parse_log(
                    line=line,
                    device_id=batch["device_id"],
                    batch_id=batch["batch_id"],
                    log_type=batch["log_type"],
                    received_at=received_at,
                    source_timezone="Asia/Kolkata",
                )

                event["line_number"] = line_number
                events.append(event)

        except Exception as error:
            print(f"ERROR reading {evidence_path}: {type(error).__name__}: {error}")
            continue

    
    
    events.sort(key=lambda event: (
        event["timestamp"] is None,
        datetime.fromisoformat(event["timestamp"]).astimezone(
            timezone.utc
        ) if event["timestamp"] else datetime.max.replace(
            tzinfo=timezone.utc
        )
    ))


    if severity:
        events = [e for e in events if e["severity"] == severity]

    if device_id:
        events = [e for e in events if e["device_id"] == device_id]

    if event_type:
        events = [e for e in events if e["event_type"] == event_type]

    if username:
        events = [e for e in events if e["username"] == username]

    return {
        "total": len(events),
        "events": events
    }

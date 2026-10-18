
"""Persistent incident investigations for Tracepoint."""

from datetime import datetime, timezone
import sqlite3
import json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import connect

router = APIRouter(prefix="/api/v1/investigations", tags=["investigations"])


def now():
    return datetime.now(timezone.utc).isoformat()


def current_user_id(request: Request):
    from app.auth import current_user

    user = current_user(request)

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="Sign in required"
        )
    return user["id"]

def initialize():
    with connect() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS investigations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                severity TEXT NOT NULL DEFAULT 'medium',
                status TEXT NOT NULL DEFAULT 'open',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS investigation_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                investigation_id INTEGER NOT NULL
                    REFERENCES investigations(id) ON DELETE CASCADE,
                event_reference TEXT NOT NULL,
                linked_at TEXT NOT NULL,
                UNIQUE(investigation_id, event_reference)
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS investigation_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                investigation_id INTEGER NOT NULL
                    REFERENCES investigations(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)


class CreateInvestigation(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    description: str = Field(default="", max_length=3000)
    severity: str = Field(default="medium", pattern="^(low|medium|high|critical)$")


class UpdateInvestigation(BaseModel):
    status: str = Field(pattern="^(open|investigating|resolved)$")


class AddNote(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


class LinkEvent(BaseModel):
    event_reference: str = Field(min_length=1, max_length=500)


def get_owned_case(db, case_id, user_id):
    row = db.execute(
        "SELECT * FROM investigations WHERE id=? AND user_id=?",
        (case_id, user_id),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Investigation not found")

    return dict(row)


@router.get("")
def list_investigations(request: Request):
    user_id = current_user_id(request)

    with connect() as db:
        rows = db.execute("""
            SELECT i.*,
                (SELECT COUNT(*) FROM investigation_events e
                 WHERE e.investigation_id=i.id) AS event_count,
                (SELECT COUNT(*) FROM investigation_notes n
                 WHERE n.investigation_id=i.id) AS note_count
            FROM investigations i
            WHERE i.user_id=?
            ORDER BY i.updated_at DESC
        """, (user_id,)).fetchall()

    return {"items": [dict(row) for row in rows]}


@router.post("", status_code=201)
def create_investigation(
    payload: CreateInvestigation,
    request: Request,
):
    user_id = current_user_id(request)
    timestamp = now()

    with connect() as db:
        cursor = db.execute(
            """
            INSERT INTO investigations
                (user_id, title, description, severity,
                 status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'open', ?, ?)
            """,
            (
                user_id,
                payload.title,
                payload.description,
                payload.severity,
                timestamp,
                timestamp,
            ),
        )

        return get_owned_case(db, cursor.lastrowid, user_id)


def validate_event_reference(reference: str):
    """Require an exact match with a currently stored timeline event."""
    try:
        supplied = json.loads(reference)
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(
            status_code=422,
            detail="Event reference must be valid JSON"
        )

    if not isinstance(supplied, dict):
        raise HTTPException(
            status_code=422,
            detail="Event reference must be a JSON object"
        )

    fields = (
        "device_id",
        "batch_id",
        "timestamp",
        "event_type",
        "username",
        "message",
    )

    if set(supplied) != set(fields):
        raise HTTPException(
            status_code=422,
            detail="Invalid event reference fields"
        )

    from app.main import get_timeline

    timeline = get_timeline(
        severity=None,
        device_id=None,
        event_type=None,
        username=None,
    )

    events = timeline.get("events", [])

    for event in events:
        expected = {
            "device_id": event.get("device_id") or "",
            "batch_id": event.get("batch_id") or "",
            "timestamp": (
                event.get("timestamp")
                or event.get("event_timestamp")
                or event.get("received_at")
                or ""
            ),
            "event_type": (
                event.get("event_type")
                or event.get("type")
                or ""
            ),
            "username": event.get("username") or "",
            "message": str(
                event.get("message")
                or event.get("raw_line")
                or ""
            )[:100],
        }

        if supplied == expected:
            return

    raise HTTPException(
        status_code=422,
        detail="Event reference does not match any collected timeline event"
    )



@router.post("/{case_id}/events", status_code=201)
def link_event(case_id: int, payload: LinkEvent, request: Request):
    user_id = current_user_id(request)

    with connect() as db:
        get_owned_case(db, case_id, user_id)

        validate_event_reference(payload.event_reference)

        timestamp = now()

        try:
            cursor = db.execute("""
                INSERT INTO investigation_events
                    (investigation_id, event_reference, linked_at)
                VALUES (?, ?, ?)
            """, (case_id, payload.event_reference, timestamp))
        except sqlite3.IntegrityError:
            raise HTTPException(
                status_code=409,
                detail="Event is already linked to this investigation"
            )

        db.execute("""
            UPDATE investigations
            SET updated_at = ?
            WHERE id = ?
        """, (timestamp, case_id))

        row = db.execute(
            "SELECT * FROM investigation_events WHERE id = ?",
            (cursor.lastrowid,)
        ).fetchone()

    return dict(row)




@router.get("/{case_id}")
def get_investigation(case_id: int, request: Request):
    user_id = current_user_id(request)

    with connect() as db:
        result = get_owned_case(db, case_id, user_id)

        result["events"] = [
            dict(row) for row in db.execute(
                "SELECT * FROM investigation_events WHERE investigation_id=?",
                (case_id,),
            ).fetchall()
        ]

        result["notes"] = [
            dict(row) for row in db.execute(
                "SELECT * FROM investigation_notes WHERE investigation_id=? "
                "ORDER BY created_at DESC",
                (case_id,),
            ).fetchall()
        ]

    return result


@router.patch("/{case_id}")
def update_investigation(
    case_id: int,
    payload: UpdateInvestigation,
    request: Request,
):
    user_id = current_user_id(request)

    with connect() as db:
        get_owned_case(db, case_id, user_id)

        db.execute(
            "UPDATE investigations SET status=?, updated_at=? WHERE id=?",
            (payload.status, now(), case_id),
        )

        result = get_owned_case(db, case_id, user_id)

    return result


@router.post("/{case_id}/notes", status_code=201)
def add_note(case_id: int, payload: AddNote, request: Request):
    user_id = current_user_id(request)
    timestamp = now()

    with connect() as db:
        get_owned_case(db, case_id, user_id)

        cursor = db.execute("""
            INSERT INTO investigation_notes
            (investigation_id, content, created_at)
            VALUES (?, ?, ?)
        """, (case_id, payload.content, timestamp))

        db.execute(
            "UPDATE investigations SET updated_at=? WHERE id=?",
            (timestamp, case_id),
        )

        row = db.execute(
            "SELECT * FROM investigation_notes WHERE id=?",
            (cursor.lastrowid,),
        ).fetchone()

    return dict(row)


initialize()

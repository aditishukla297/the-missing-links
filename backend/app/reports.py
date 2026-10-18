
import io
import json
import re
from datetime import datetime, timezone
from html import escape
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer,
    HRFlowable, KeepTogether, Table, TableStyle,
)

from app.auth import connect
from app.investigations import current_user_id, get_owned_case

router = APIRouter(
    prefix="/api/v1/investigations",
    tags=["reports"],
)

PURPLE = colors.HexColor("#6652C8")


def safe(value):
    return escape(str(value if value is not None else "N/A"))


def evidence_for_report(events):
    """Collect and verify distinct evidence batches linked to a case."""
    from app.main import verify_evidence

    batches = {}
    safe_id = re.compile(r"^[A-Za-z0-9_-]+$")

    for item in events:
        try:
            event = json.loads(item["event_reference"])
        except (ValueError, TypeError):
            continue

        if not isinstance(event, dict):
            continue

        device_id = event.get("device_id")
        batch_id = event.get("batch_id")

        if not isinstance(device_id, str) or not isinstance(batch_id, str):
            continue

        if not safe_id.fullmatch(device_id) or not safe_id.fullmatch(batch_id):
            continue

        batches[(device_id, batch_id)] = None

    results = []

    for device_id, batch_id in sorted(batches):
        metadata_path = (
            Path(__file__).resolve().parent.parent
            / "data" / "evidence"
            / device_id
            / f"{batch_id}.meta.json"
        )

        metadata = {}
        metadata_error = False

        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            if not isinstance(metadata, dict):
                metadata = {}
                metadata_error = True
        except (OSError, ValueError):
            metadata_error = True

        if metadata_error:
            verification = {
                "status": "invalid_metadata",
                "verified": False,
            }
        else:
            try:
                verification = verify_evidence(
                    device_id=device_id,
                    batch_id=batch_id,
                )
            except HTTPException as exc:
                verification = {
                    "status": "verification_error",
                    "verified": False,
                    "detail": exc.detail,
                }

        results.append({
            "device_id": device_id,
            "batch_id": batch_id,
            "sha256": metadata.get("sha256"),
            "received_at": metadata.get("received_at"),
            "line_count": metadata.get("line_count"),
            "status": verification.get("status", "unknown"),
        })

    return results


@router.get("/{case_id}/report")
def download_report(case_id: int, request: Request):
    user_id = current_user_id(request)

    with connect() as db:
        case = get_owned_case(db, case_id, user_id)

        events = [
            dict(row) for row in db.execute(
                "SELECT * FROM investigation_events "
                "WHERE investigation_id=? ORDER BY linked_at",
                (case_id,),
            ).fetchall()
        ]

        notes = [
            dict(row) for row in db.execute(
                "SELECT * FROM investigation_notes "
                "WHERE investigation_id=? ORDER BY created_at",
                (case_id,),
            ).fetchall()
        ]

    evidence_batches = evidence_for_report(events)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=22 * mm,
        leftMargin=22 * mm,
        topMargin=22 * mm,
        bottomMargin=22 * mm,
    )

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="TraceTitle",
        parent=styles["Title"],
        fontSize=23,
        leading=28,
        textColor=PURPLE,
        alignment=TA_CENTER,
        spaceAfter=12,
    ))
    styles.add(ParagraphStyle(
        name="TraceSection",
        parent=styles["Heading2"],
        textColor=PURPLE,
        spaceBefore=15,
        spaceAfter=8,
    ))
    styles.add(ParagraphStyle(
        name="TraceBody",
        parent=styles["BodyText"],
        fontSize=9,
        leading=14,
        spaceAfter=7,
        wordWrap="CJK",
    ))

    story = []

    def paragraph(text):
        story.append(Paragraph(text, styles["TraceBody"]))

    def section(title):
        story.append(Paragraph(title, styles["TraceSection"]))

    story.append(Paragraph("TRACEPOINT", styles["TraceTitle"]))
    story.append(Paragraph(
        "DIGITAL FORENSIC INVESTIGATION REPORT",
        styles["Normal"],
    ))
    story.append(Spacer(1, 12))
    story.append(HRFlowable(
        width="100%", thickness=1, color=PURPLE
    ))

    generated = datetime.now(timezone.utc).isoformat()

    section("Investigation Summary")
    paragraph(f"<b>Case:</b> TP-{case_id:04d}")
    paragraph(f"<b>Title:</b> {safe(case['title'])}")
    paragraph(f"<b>Description:</b> {safe(case['description'])}")
    paragraph(f"<b>Severity:</b> {safe(case['severity'])}")
    paragraph(f"<b>Status:</b> {safe(case['status'])}")
    paragraph(f"<b>Created:</b> {safe(case['created_at'])}")
    paragraph(f"<b>Last Updated:</b> {safe(case['updated_at'])}")
    paragraph(f"<b>Report Generated (UTC):</b> {safe(generated)}")

    section(f"Linked Timeline Events ({len(events)})")

    if not events:
        paragraph("No events linked to this investigation.")

    for index, item in enumerate(events, 1):
        try:
            event = json.loads(item["event_reference"])
        except (ValueError, TypeError):
            event = {"message": item["event_reference"]}

        paragraph(
            f"<b>Event {index}</b> - "
            f"{safe(event.get('event_type', 'Unknown'))}"
        )
        paragraph(
            f"<b>Device:</b> {safe(event.get('device_id'))} | "
            f"<b>Batch:</b> {safe(event.get('batch_id'))}"
        )
        paragraph(
            f"<b>Timestamp:</b> {safe(event.get('timestamp'))} | "
            f"<b>Username:</b> {safe(event.get('username'))}"
        )
        paragraph(
            f"<b>Message:</b> {safe(event.get('message'))}"
        )
        story.append(Spacer(1, 7))

    section(f"Analyst Notes ({len(notes)})")

    if not notes:
        paragraph("No analyst notes recorded.")

    for index, note in enumerate(notes, 1):
        paragraph(
            f"<b>Note {index} - {safe(note['created_at'])}</b>"
        )
        paragraph(safe(note["content"]))

    verified_count = sum(
        evidence["status"] == "verified" for evidence in evidence_batches
    )
    story.append(KeepTogether([
        Paragraph(
            f"Evidence Integrity ({len(evidence_batches)} batches)",
            styles["TraceSection"],
        ),
        Paragraph(
            f"<b>{verified_count} verified / "
            f"{len(evidence_batches)} total evidence batches</b>",
            styles["TraceBody"],
        ),
    ]))

    if not evidence_batches:
        paragraph("No source evidence batches were identified for this investigation.")

    for index, evidence in enumerate(evidence_batches, 1):
        status_labels = {
            "verified": "VERIFIED",
            "mismatch": "HASH MISMATCH",
            "missing": "EVIDENCE MISSING",
            "invalid_metadata": "INVALID METADATA",
            "verification_error": "VERIFICATION ERROR",
        }

        status = status_labels.get(
            evidence["status"], "UNKNOWN"
        )

        rows = [
            ["Device", safe(evidence["device_id"])],
            ["Batch ID", safe(evidence["batch_id"])],
            ["Received", safe(evidence["received_at"])],
            ["Log lines", safe(evidence["line_count"])],
            ["SHA-256", safe(evidence["sha256"])],
            ["Verification", status],
        ]

        table = Table(
            [
                [
                    Paragraph(
                        f"<b>{label}</b>",
                        styles["TraceBody"],
                    ),
                    Paragraph(
                        value,
                        styles["TraceBody"],
                    ),
                ]
                for label, value in rows
            ],
            colWidths=[35 * mm, 125 * mm],
            hAlign="LEFT",
        )

        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1),
             colors.HexColor("#F7F5FC")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("LINEBELOW", (0, 0), (-1, -2),
             0.4, colors.HexColor("#ECE9F5")),
        ]))

        story.append(KeepTogether([
            Paragraph(
                f"Evidence Batch {index}",
                styles["TraceSection"],
            ),
            table,
            Spacer(1, 12),
        ]))

    paragraph(
        "<b>Verification method:</b> SHA-256 was recalculated from "
        "each available evidence file during report generation and "
        "compared with its recorded metadata hash. A match establishes "
        "consistency with that metadata, not independent authenticity "
        "or chain of custody."
    )

    section("Report Disclaimer")
    paragraph(
        "This report is generated from investigation records stored "
        "in Tracepoint. Event references and analyst notes should be "
        "interpreted alongside the original evidence files."
    )

    def draw_footer(canvas, document):
        canvas.saveState()

        width, height = A4

        canvas.setStrokeColor(colors.HexColor("#E7E3F2"))
        canvas.line(22 * mm, 17 * mm, width - 22 * mm, 17 * mm)

        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#817B91"))

        canvas.drawString(
            22 * mm,
            12 * mm,
            f"TRACEPOINT  |  TP-{case_id:04d}"
        )

        canvas.drawRightString(
            width - 22 * mm,
            12 * mm,
            f"Page {document.page}"
        )

        canvas.restoreState()

    doc.build(
        story,
        onFirstPage=draw_footer,
        onLaterPages=draw_footer,
    )
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition":
                f'attachment; filename="Tracepoint_TP-{case_id:04d}.pdf"'
        },
    )


import re
from datetime import datetime
from zoneinfo import ZoneInfo


def parse_log(
    line,
    device_id,
    batch_id,
    log_type,
    received_at=None,
    source_timezone="Asia/Kolkata",
):
    """Convert one raw log line into a structured event."""

    event = {
        "device_id": device_id,
        "batch_id": batch_id,
        "log_type": log_type,
        "raw_log": line,
        "timestamp": None,
        "timestamp_inferred": False,
        "timestamp_conflict": False,  # ADD THIS LINE
        "timestamp_source": "unknown",
        "source_timezone": source_timezone,
        "received_at": received_at,
        "event_type": "unknown",
        "severity": "info",
        "username": None,
    }

    # Traditional Linux syslog timestamp, e.g. Oct 19 10:15:20
    # This format does not contain a year or timezone.
    match = re.match(
        r"^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})",
        line,
    )

    if match and received_at:
        try:
            # Convert the evidence receipt time into a datetime.
            received = datetime.fromisoformat(
                received_at.replace("Z", "+00:00")
            )

            if received.tzinfo is None:
                raise ValueError("Missing receipt timezone")

            # Convert receipt time to the source machine's timezone.
            local_tz = ZoneInfo(source_timezone)
            received_local = received.astimezone(local_tz)

            # Parse the month, day, and time from the log.
            parsed = datetime.strptime(
                match.group(1),
                "%b %d %H:%M:%S",
            )

            # Infer the year using the evidence receipt date.
            event_time = parsed.replace(
                year=received_local.year,
                tzinfo=local_tz,
            )

            # If the inferred event is in the future,
            # assume it belongs to the previous year.
                        # Only infer the previous year around New Year.
            if (
                received_local.month == 1
                and event_time.month == 12
                and event_time > received_local
            ):
                event_time = event_time.replace(
                    year=event_time.year - 1
                )

            # Flag timestamps that appear to be in the future.
            event["timestamp_conflict"] = (
                event_time > received_local
            )

            # Store a timezone-aware ISO 8601 timestamp.
            event["timestamp"] = event_time.isoformat()
            event["timestamp_inferred"] = True
            event["timestamp_source"] = "syslog_inferred"

        except (ValueError, OverflowError):
            # Keep timestamp as None if parsing fails.
            pass

    # Identify authentication events.
    if "Failed password" in line:
        event["event_type"] = "failed_login"
        event["severity"] = "warning"

    elif "Accepted password" in line:
        event["event_type"] = "successful_login"
        event["severity"] = "info"

    elif "Invalid user" in line:
        event["event_type"] = "invalid_user"
        event["severity"] = "warning"

    elif "authentication failure" in line.lower():
        event["event_type"] = "authentication_failure"
        event["severity"] = "warning"

    # Extract usernames from common SSH authentication messages.
    username_match = re.search(
        r"(?:for|user)\s+(?:invalid user\s+)?([a-zA-Z0-9_.-]+)",
        line,
    )

    if username_match:
        event["username"] = username_match.group(1)

    return event

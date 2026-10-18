"""Cross-platform log normalization; preserves the original raw line."""
import json
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

SYSLOG = re.compile(r"^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\b")
MACOS = re.compile(r"^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{4})\s")
ISO = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\b")

def _timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.isoformat() if parsed.tzinfo is not None else None
    except ValueError:
        return None

def parse_log(line, device_id, batch_id, log_type, received_at=None, source_timezone='Asia/Kolkata'):
    event = {
        'device_id': device_id, 'batch_id': batch_id, 'log_type': log_type,
        'raw_log': line, 'timestamp': None, 'timestamp_inferred': False,
        'timestamp_conflict': False, 'timestamp_source': 'unknown',
        'source_timezone': source_timezone, 'received_at': received_at,
        'event_type': 'unknown', 'severity': 'info', 'username': None,
        'log_format': 'unknown', 'parse_status': 'partial', 'parse_warnings': [],
    }
    message = line
    if line.lstrip().startswith('{'):
        try:
            obj = json.loads(line)
            if not isinstance(obj, dict):
                raise ValueError('JSON log must be an object')
            if 'EventID' in obj or 'EventId' in obj:
                event['log_format'] = 'windows_event_json'
                event_id = int(obj.get('EventID', obj.get('EventId')))
                mapping = {4625: ('failed_login', 'warning'), 4624: ('successful_login', 'info'), 4634: ('logout', 'info'), 4740: ('account_lockout', 'warning')}
                if event_id in mapping:
                    event['event_type'], event['severity'] = mapping[event_id]
                event['username'] = obj.get('TargetUserName') or obj.get('AccountName')
                event['timestamp'] = _timestamp(obj.get('TimeCreated') or obj.get('timestamp'))
                event['timestamp_source'] = 'embedded' if event['timestamp'] else 'unknown'
                message = str(obj.get('Message') or '')
            else:
                event['log_format'] = 'json'
                message = str(obj.get('message') or obj.get('msg') or '')
                event['timestamp'] = _timestamp(obj.get('timestamp') or obj.get('time'))
                event['timestamp_source'] = 'embedded' if event['timestamp'] else 'unknown'
                event['username'] = obj.get('username')
        except (ValueError, TypeError, json.JSONDecodeError):
            event['parse_warnings'].append('Invalid JSON log')
    elif (match := MACOS.match(line)):
        event['log_format'] = 'macos_unified_text'
        event['timestamp'] = _timestamp(match.group(1).replace(' ', 'T', 1))
        event['timestamp_source'] = 'embedded' if event['timestamp'] else 'unknown'
    elif (match := SYSLOG.match(line)):
        event['log_format'] = 'linux_syslog'
        if received_at:
            try:
                received = datetime.fromisoformat(received_at.replace('Z', '+00:00'))
                if received.tzinfo is None:
                    raise ValueError('Receipt time lacks timezone')
                tz = ZoneInfo(source_timezone)
                local = received.astimezone(tz)
                parsed = datetime.strptime(match.group(1), '%b %d %H:%M:%S')
                inferred = parsed.replace(year=local.year, tzinfo=tz)
                if local.month == 1 and inferred.month == 12 and inferred > local:
                    inferred = inferred.replace(year=inferred.year - 1)
                event['timestamp'] = inferred.isoformat()
                event['timestamp_inferred'] = True
                event['timestamp_conflict'] = inferred > local
                event['timestamp_source'] = 'syslog_inferred'
            except (ValueError, OverflowError, KeyError):
                event['parse_warnings'].append('Could not infer syslog timestamp')
    elif (match := ISO.match(line)):
        event['log_format'] = 'iso8601_text'
        event['timestamp'] = _timestamp(match.group(1))
        event['timestamp_source'] = 'embedded' if event['timestamp'] else 'unknown'

    if event['event_type'] == 'unknown':
        lower = message.lower()
        if 'failed password' in lower or 'failed to log on' in lower:
            event['event_type'], event['severity'] = 'failed_login', 'warning'
        elif 'accepted password' in lower or 'successfully logged on' in lower:
            event['event_type'] = 'successful_login'
        elif 'invalid user' in lower:
            event['event_type'], event['severity'] = 'invalid_user', 'warning'
        elif 'authentication failure' in lower:
            event['event_type'], event['severity'] = 'authentication_failure', 'warning'
    if not event['username']:
        found = re.search(r'(?:for|user)\s+(?:invalid user\s+)?([a-zA-Z0-9_.-]+)', message)
        if found:
            event['username'] = found.group(1)
    if event['log_format'] == 'unknown':
        event['parse_warnings'].append('Unrecognized log format')
    if not event['timestamp']:
        event['parse_warnings'].append('Timestamp not parsed')
    if event['event_type'] == 'unknown':
        event['parse_warnings'].append('Event type not recognized')
    # TRACEPOINT_TZ_V1: preserve source time and derive sortable UTC instant.
    event['timestamp_utc'] = None
    if event['timestamp']:
        try:
            parsed_time = datetime.fromisoformat(event['timestamp'].replace('Z', '+00:00'))
            if parsed_time.tzinfo is not None:
                event['timestamp_utc'] = parsed_time.astimezone(timezone.utc).isoformat()
        except ValueError:
            event['parse_warnings'].append('Cannot normalize timestamp to UTC')
    # TRACEPOINT_PARSING_GAPS_V1: expose exactly which fields could not be extracted.
    event['missing_fields'] = [
        field for field in ('timestamp', 'event_type', 'log_format')
        if (event[field] is None if field == 'timestamp' else event[field] == 'unknown')
    ]
    event['parse_gap_count'] = len(event['parse_warnings'])
    event['parse_status'] = 'complete' if not event['parse_warnings'] else 'partial'
    return event

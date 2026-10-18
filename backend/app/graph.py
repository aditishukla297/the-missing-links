"""Deterministic, evidence-linked correlation for Tracepoint."""
from datetime import datetime, timezone
from collections import defaultdict
from fastapi import APIRouter

router = APIRouter(prefix='/api/v1/graph', tags=['investigation-graph'])
FAILURES = {'failed_login', 'invalid_user', 'authentication_failure'}
WINDOW_SECONDS = 30 * 60
MAX_EVENTS = 1500

def moment(event):
    value = event.get('timestamp_utc') or event.get('timestamp')
    if not value:
        return None
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result.astimezone(timezone.utc) if result.tzinfo else None
    except (TypeError, ValueError, OverflowError):
        return None

def build_graph(events):
    nodes, edges = [], []
    indexed = []
    for event in events[:MAX_EVENTS]:
        device, batch, line = event.get('device_id'), event.get('batch_id'), event.get('line_number')
        if not (device and batch and isinstance(line, int)):
            continue
        identity = f'{device}:{batch}:{line}'
        time = moment(event)
        username = event.get('username')
        nodes.append({
            'id': identity, 'device_id': device, 'batch_id': batch, 'line_number': line,
            'username': username, 'timestamp': event.get('timestamp'),
            'timestamp_utc': event.get('timestamp_utc'), 'event_type': event.get('event_type'),
            'severity': event.get('severity'), 'parse_status': event.get('parse_status'),
            'parse_warnings': event.get('parse_warnings') or [],
            'timestamp_inferred': bool(event.get('timestamp_inferred')),
            'raw_log': event.get('raw_log'),
        })
        if time and username and event.get('event_type') in FAILURES | {'successful_login'}:
            indexed.append((time, identity, str(username).casefold(), str(device), event.get('event_type')))
    indexed.sort(key=lambda x: x[0])
    by_user = defaultdict(list)
    for item in indexed:
        by_user[item[2]].append(item)
    for username, group in by_user.items():
        for i, current in enumerate(group):
            if current[4] != 'successful_login':
                continue
            preceding = []
            for earlier in reversed(group[:i]):
                seconds = (current[0] - earlier[0]).total_seconds()
                if seconds > WINDOW_SECONDS:
                    break
                if earlier[4] in FAILURES:
                    preceding.append(earlier)
            for earlier in reversed(preceding[-8:]):
                same_device = earlier[3] == current[3]
                edges.append({
                    'source': earlier[1], 'target': current[1],
                    'type': 'failure_before_success',
                    'reason': 'Same username and device within 30 minutes' if same_device else 'Same username across devices within 30 minutes; identity alone does not prove the events are related',
                    'confidence': 'stronger' if same_device else 'tentative',
                    'seconds_apart': round((current[0] - earlier[0]).total_seconds()),
                })
    return {
        'nodes': nodes, 'edges': edges, 'total_events_considered': min(len(events), MAX_EVENTS),
        'truncated': len(events) > MAX_EVENTS,
        'rules': ['Failed authentication followed by successful login for the same username within 30 minutes', 'Same-device links are stronger; cross-device links are tentative', 'Events without valid timestamps or usernames are not linked automatically'],
        'disclaimer': 'Correlations are investigative leads, not proof of compromise.',
    }

@router.get('')
def investigation_graph():
    from app.main import get_timeline
    timeline = get_timeline(severity=None, device_id=None, event_type=None, username=None)
    return build_graph(timeline.get('events', []))

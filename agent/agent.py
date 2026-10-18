
import hashlib
import json
import os
import time
import uuid
from pathlib import Path

import requests

SERVER_URL = "http://127.0.0.1:8000/api/v1/ingest"
DEVICE_ID = "macbook-01"
LOG_TYPE = "auth"

LOG_FILE = Path("sample.log")
STATE_FILE = Path("agent-state.json")
PENDING_FILE = Path("pending-batch.json")

POLL_INTERVAL = 5
MAX_LINES = 100


def save_json_atomic(path, data):
    temp_path = path.with_suffix(path.suffix + ".tmp")

    with temp_path.open("w", encoding="utf-8") as file:
        json.dump(data, file)
        file.flush()
        os.fsync(file.fileno())

    os.replace(temp_path, path)


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())

    return {"offset": 0}


def send_pending_batch(api_key):
    if not PENDING_FILE.exists():
        return True

    pending = json.loads(PENDING_FILE.read_text())

    try:
        response = requests.post(
            SERVER_URL,
            headers={"X-API-Key": api_key},
            json=pending["payload"],
            timeout=10
        )

        response.raise_for_status()
        result = response.json()

        if result.get("status") not in ("accepted", "duplicate"):
            raise ValueError("Unexpected server response")

        save_json_atomic(
            STATE_FILE,
            {"offset": pending["next_offset"]}
        )

        PENDING_FILE.unlink()

        print(
            f"Batch {result['status']}: "
            f"{len(pending['payload']['lines'])} lines"
        )

        return True

    except (requests.RequestException, ValueError) as error:
        print(f"Delivery failed; will retry: {error}")
        return False


def collect_new_lines():
    LOG_FILE.touch(exist_ok=True)

    state = load_state()
    offset = state["offset"]

    file_size = LOG_FILE.stat().st_size

    if file_size < offset:
        print("Log file was truncated; restarting at offset 0")
        offset = 0

    lines = []

    with LOG_FILE.open("rb") as file:
        file.seek(offset)

        while len(lines) < MAX_LINES:
            line = file.readline()

            if not line:
                break

            # Wait for a complete line before collecting it.
            if not line.endswith(b"\n"):
                break

            lines.append(line.decode("utf-8", errors="replace").rstrip("\r\n"))

        next_offset = file.tell()

    if not lines:
        return

    payload = {
        "device_id": DEVICE_ID,
        "batch_id": str(uuid.uuid4()),
        "log_type": LOG_TYPE,
        "lines": lines
    }

    save_json_atomic(
        PENDING_FILE,
        {
            "payload": payload,
            "next_offset": next_offset
        }
    )

    print(f"Collected {len(lines)} new log lines")


def main():
    api_key = os.getenv("AGENT_API_KEY")

    if not api_key:
        raise RuntimeError("AGENT_API_KEY is not configured")

    print("The Missing Links Agent started")
    print(f"Watching: {LOG_FILE.resolve()}")
    print(f"Polling every {POLL_INTERVAL} seconds")

    while True:
        try:
            if PENDING_FILE.exists():
                send_pending_batch(api_key)
            else:
                collect_new_lines()

        except Exception as error:
            print(f"Agent error: {error}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nAgent stopped")


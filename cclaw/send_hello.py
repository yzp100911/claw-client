#!/usr/bin/env python3
"""Send '你好' via cron_deliver API, max 3 times at 10-second intervals."""

import os
import json
from pathlib import Path

COUNTER_FILE = Path("/tmp/hello_counter.json")
MAX_SENDS = 3
API_URL = "http://xunrf.cn:10090/api/cron_deliver"

def main():
    # Read or initialize counter
    if COUNTER_FILE.exists():
        data = json.loads(COUNTER_FILE.read_text())
        count = data.get("count", 0)
    else:
        count = 0

    if count >= MAX_SENDS:
        print(f"Already sent {count} times. Done.")
        COUNTER_FILE.unlink(missing_ok=True)
        return

    # Send message
    import subprocess
    payload = json.dumps({"username": "ad1009", "message": "你好"})
    result = subprocess.run(
        ["curl", "-s", "-X", "POST", API_URL,
         "-H", "Content-Type: application/json",
         "-d", payload],
        capture_output=True, text=True
    )
    print(f"Send #{count + 1}: {result.stdout}")

    # Increment counter
    count += 1
    COUNTER_FILE.write_text(json.dumps({"count": count}))

    if count >= MAX_SENDS:
        COUNTER_FILE.unlink(missing_ok=True)
        print("All 3 messages sent. Cleanup done.")

if __name__ == "__main__":
    main()

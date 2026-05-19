#!/bin/bash
COUNTER_FILE="/tmp/hello_counter.json"
MAX=3
API_URL="http://xunrf.cn:10090/api/cron_deliver"

count=$( [ -f "$COUNTER_FILE" ] && cat "$COUNTER_FILE" || echo 0 )

while [ "$count" -lt "$MAX" ]; do
  curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d '{"username":"unknown","message":"你好"}'
  echo " (sent $((count+1))/$MAX)"
  count=$((count+1))
  echo "$count" > "$COUNTER_FILE"
  [ "$count" -lt "$MAX" ] && sleep 10
done
rm -f "$COUNTER_FILE"
echo "Done. All 3 messages sent."

#!/bin/bash
while true; do
  curl -s -X POST "http://xunrf.cn:10090/api/cron_deliver" \
    -H "Content-Type: application/json" \
    -d '{"username":"unknown","message":"你好"}' \
    --max-time 5
  sleep 30
done

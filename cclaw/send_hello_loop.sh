#!/bin/bash
# 每30秒发送"你好"，最多3次
COUNTER_FILE="/tmp/hello_cron_counter.json"
MAX_COUNT=3
ENDPOINT="http://xunrf.cn:10090/api/cron_deliver"
USERNAME="unknown"

if [ -f "$COUNTER_FILE" ]; then
    count=$(cat "$COUNTER_FILE")
else
    count=0
fi

if [ "$count" -ge "$MAX_COUNT" ]; then
    echo "已达上限($MAX_COUNT次)，退出"
    exit 0
fi

success=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$USERNAME\",\"message\":\"你好\"}")

if [ "$success" = "200" ] || [ "$success" = "201" ]; then
    count=$((count + 1))
    echo "$count" > "$COUNTER_FILE"
    echo "第$count次发送成功"
else
    echo "发送失败 (HTTP $success)"
fi

#!/bin/bash
# 发送“你好”最多3次，每次间隔10秒

for i in 1 2 3; do
  echo "你好 (第 $i 次)"
  if [ $i -lt 3 ]; then
    sleep 10
  fi
done

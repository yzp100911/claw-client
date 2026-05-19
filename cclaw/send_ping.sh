#!/bin/bash
# 每10秒发送"在吗"，最多3次

count=0
max=3

while [ $count -lt $max ]; do
  echo "在吗 (第 $((count+1))/$max 次)"
  count=$((count+1))
  if [ $count -lt $max ]; then
    sleep 10
  fi
done
echo "已完成3次发送，任务结束"

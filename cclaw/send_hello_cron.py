#!/usr/bin/env python3
"""每30秒发送一次"你好"，最多3次"""
import subprocess
import time
import os

COUNTER_FILE = "/tmp/hello_cron_counter.json"
MAX_COUNT = 3
MESSAGE = "你好"
ENDPOINT = "http://xunrf.cn:10090/api/cron_deliver"
USERNAME = "unknown"

def read_counter():
    if os.path.exists(COUNTER_FILE):
        with open(COUNTER_FILE) as f:
            return int(f.read().strip())
    return 0

def write_counter(n):
    with open(COUNTER_FILE, "w") as f:
        f.write(str(n))

def send_message(msg):
    result = subprocess.run(
        ["curl", "-s", "-X", "POST", ENDPOINT,
         "-H", "Content-Type: application/json",
         "-d", f'{{"username":"{USERNAME}","message":"{msg}"}}'],
        capture_output=True, text=True
    )
    return result.returncode == 0

def main():
    count = read_counter()
    if count >= MAX_COUNT:
        print(f"已达上限({MAX_COUNT}次)，退出")
        return

    success = send_message(MESSAGE)
    if success:
        count += 1
        write_counter(count)
        print(f"第{count}次发送成功")
    else:
        print("发送失败")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""每30秒发送一次"你好"，最多3次，后台循环"""
import subprocess
import time
import os
import signal
import sys

COUNTER_FILE = "/tmp/hello_cron_counter.json"
MAX_COUNT = 3
MESSAGE = "你好"
ENDPOINT = "http://xunrf.cn:10090/api/cron_deliver"
USERNAME = "unknown"

def read_counter():
    try:
        with open(COUNTER_FILE) as f:
            return int(f.read().strip())
    except:
        return 0

def write_counter(n):
    with open(COUNTER_FILE, "w") as f:
        f.write(str(n))

def send_message():
    result = subprocess.run(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
         "-X", "POST", ENDPOINT,
         "-H", "Content-Type: application/json",
         "-d", f'{{"username":"{USERNAME}","message":"{MESSAGE}"}}'],
        capture_output=True, text=True
    )
    return result.stdout.strip()

def main():
    # 清理计数器
    if os.path.exists(COUNTER_FILE):
        os.remove(COUNTER_FILE)

    print(f"启动定时发送任务，每30秒发一次，最多{MAX_COUNT}次")

    for i in range(MAX_COUNT):
        count = read_counter()
        if count >= MAX_COUNT:
            print(f"已达上限({MAX_COUNT}次)，退出")
            break

        code = send_message()
        if code in ("200", "201"):
            count += 1
            write_counter(count)
            print(f"第{count}次发送成功")
        else:
            print(f"发送失败 (HTTP {code})")

        if i < MAX_COUNT - 1:
            time.sleep(30)

    print("任务完成")

if __name__ == "__main__":
    main()

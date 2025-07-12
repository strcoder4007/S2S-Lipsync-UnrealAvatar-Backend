import requests
import json
import subprocess
import time


url = "http://localhost:8011/A2F/USD/Load"

headers = {
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "Content-Type": "application/json",
    "Origin": "http://localhost:8011",
    "Referer": "http://localhost:8011/docs",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "accept": "application/json",
    "sec-ch-ua": '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
}

data = {
    "file_name": "C:/Users/mynam/Downloads/a2f.usd"
}

response = requests.post(url, headers=headers, data=json.dumps(data))


print("First Request Status:", response.status_code)
print("First Request Response:", response.text)
time.sleep(2)
if response.status_code == 200:
    curl1_command = [
        "curl", "-X", "POST", "http://localhost:8011/A2F/A2E/SetEmotion",
        "-H", "accept: application/json",
        "-H", "Content-Type: application/json",
        "-d", '''{
            "a2f_instance": "/World/audio2face/CoreFullface",
            "emotion": [
                0,
                0.007047028746455909,
                0,
                0.016824722290039062,
                0.03146043047308922,
                0,
                0.08242279827594757,
                0,
                0,
                0.3256818950176239
            ]
        }'''
    ]
    
    curl1_response = subprocess.run(curl1_command, capture_output=True, text=True)

    print("Curl1 Command Output:")
    print(curl1_response.stdout)
    print("Curl1 Command Error (if any):")
    print(curl1_response.stderr)

    time.sleep(2)
    if curl1_response.returncode == 0:
        curl2_command = [
            "curl", "-X", "POST", "http://localhost:8011/A2F/Exporter/ActivateStreamLivelink",
            "-H", "accept: application/json",
            "-H", "Content-Type: application/json",
            "-d", '''{
                "node_path": "/World/audio2face/StreamLivelink",
                "value": true
            }'''
        ]

        curl2_response = subprocess.run(curl2_command, capture_output=True, text=True)

        print("Curl2 Command Output:")
        print(curl2_response.stdout)
        print("Curl2 Command Error (if any):")
        print(curl2_response.stderr)
    else:
        print("curl1 failed, skipping curl2.")
else:
    print("First request failed, skipping curl1 and curl2.")

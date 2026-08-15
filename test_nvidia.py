import urllib.request
import json
import os

env_vars = {}
with open('.env.local', 'r') as f:
    for line in f:
        if line.strip() and not line.startswith('#'):
            key, val = line.strip().split('=', 1)
            env_vars[key] = val.strip("'\"")

api_key = env_vars.get('NVIDIA_API_KEY', '')

req = urllib.request.Request(
    'https://integrate.api.nvidia.com/v1/images/generations',
    data=json.dumps({
        "model": "qwen/qwen-image",
        "prompt": "Test prompt",
        "n": 1,
        "size": "1024x1024",
        "response_format": "b64_json"
    }).encode('utf-8'),
    headers={
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }
)
try:
    with urllib.request.urlopen(req) as resp:
        print(resp.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print(e.code)
    print(e.read().decode('utf-8'))

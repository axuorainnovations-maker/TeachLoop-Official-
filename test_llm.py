import urllib.request, json, os

env_vars = {}
with open('.env.local', 'r') as f:
    for line in f:
        if line.strip() and not line.startswith('#'):
            k, v = line.strip().split('=', 1)
            env_vars[k] = v.strip("'\"")

api_key = env_vars.get('NVIDIA_API_KEY', '')

req = urllib.request.Request(
    'https://integrate.api.nvidia.com/v1/chat/completions',
    data=json.dumps({
        "model": "meta/llama-3.3-70b-instruct",
        "messages": [{"role": "user", "content": "Hello! Reply with JSON: {\"status\": \"ok\"}"}],
        "max_tokens": 100
    }).encode('utf-8'),
    headers={
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }
)
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        print("NVIDIA LLM SUCCESS:")
        print(resp.read().decode('utf-8'))
except Exception as e:
    print("NVIDIA LLM ERROR:", e)

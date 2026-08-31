import os, sys, json
import riva.client

env_vars = {}
with open('.env.local', 'r') as f:
    for line in f:
        if line.strip() and not line.startswith('#'):
            k, v = line.strip().split('=', 1)
            env_vars[k] = v.strip("'\"")

NVIDIA_API_KEY = env_vars.get('NVIDIA_API_KEY', '')
RIVA_URI = 'grpc.nvcf.nvidia.com:443'
ASR_FUNCTION_ID = '71203149-d3b7-4460-8231-1be2543a1fca'

auth = riva.client.Auth(None, True, RIVA_URI,
                        [['function-id', ASR_FUNCTION_ID],
                         ['authorization', 'Bearer ' + NVIDIA_API_KEY]])
asr = riva.client.ASRService(auth)

cfg = riva.client.RecognitionConfig(
    encoding=riva.client.AudioEncoding.LINEAR_PCM,
    sample_rate_hertz=16000, language_code='en-US',
    max_alternatives=1, audio_channel_count=1
)

# empty audio
audio = b'\x00' * 32000 
try:
    print("Sending to Riva...")
    r = asr.offline_recognize(audio, cfg)
    print("Result:", r)
except Exception as e:
    print("ERROR:", e)

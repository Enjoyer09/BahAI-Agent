#!/bin/bash
TOKEN=$(cat /tmp/bahai_token.txt)
start=$(python3 -c "import time; print(int(time.time()*1000))")
curl -s -N -X POST https://www.bahai.biz.az/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"150 ədəd laptopun hər biri 800 AZN-dirsə, ümumi məbləği və 18% ƏDV-ni hesabla.","model":"auto","productMode":"web_chat","executionMode":"cloud","conversationId":"fp-test-3"}' \
  --max-time 15 > /tmp/t3.txt 2>&1
end=$(python3 -c "import time; print(int(time.time()*1000))")
python3 -c "
import json
lines = open('/tmp/t3.txt').read().split('\n')
types, text, provider = set(), [], 'fast-path'
for l in lines:
    if not l.startswith('data:'): continue
    try:
        d = json.loads(l[5:])
        types.add(d.get('type',''))
        if d.get('type')=='assistant_delta': text.append(d.get('content',''))
        if d.get('type')=='assistant_message': text.append(str(d.get('message',{}).get('content',''))[:200])
        if d.get('type')=='provider_telemetry' and d.get('event')=='provider_stream_start': provider=d.get('providerId','?')
    except: pass
print('Provider:', provider)
print('Types:', sorted(types))
print('Cavab:', ''.join(text)[:200])
"
echo "Vaxt: $((end-start))ms"

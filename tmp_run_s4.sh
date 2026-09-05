#!/bin/bash
TOKEN=$(cat /tmp/bahai_token.txt)
start=$(python3 -c "import time; print(int(time.time()*1000))")
curl -s -N \
  -X POST https://www.bahai.biz.az/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"Python-da bir siyahıdakı dublikatları silmək üçün ən sürətli üsul hansıdır? Kod nümunəsi göstər.","model":"auto","productMode":"web_chat","executionMode":"cloud","conversationId":"test-s4"}' \
  --max-time 30 > /tmp/s4.txt 2>&1
end=$(python3 -c "import time; print(int(time.time()*1000))")
python3 - <<'PYEOF'
import json
lines = open('/tmp/s4.txt').read().split('\n')
parts, providers, tools = [], [], []
for l in lines:
    if not l.startswith('data:'): continue
    try:
        d = json.loads(l[5:])
        t = d.get('type','')
        if t == 'assistant_delta': parts.append(d.get('content',''))
        elif t == 'provider_telemetry' and d.get('event') == 'provider_stream_start':
            providers.append(d.get('providerId','?') + '/' + d.get('model','?')[:40])
        elif t == 'tool_execution': tools.append(d.get('tool','?'))
    except: pass
full = ''.join(parts)
has_code = '```' in full
print('Provider:', ' → '.join(dict.fromkeys(providers)) or 'fast-path')
print('Tools:', ', '.join(tools) or 'yox')
print('Kod bloku var:', has_code)
print('Cavab:', full[:300] or '(boş)')
PYEOF
echo "Vaxt: $((end - start))ms"

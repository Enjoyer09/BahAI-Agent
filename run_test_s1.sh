#!/usr/bin/env bash
TOKEN=$(cat /tmp/bahai_token.txt)
start=$(python3 -c "import time; print(int(time.time()*1000))")
curl -s -N \
  -X POST https://www.bahai.biz.az/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"Salam! Bugün ayın neçəsidir?","model":"auto","productMode":"web_chat","executionMode":"cloud","conversationId":"test-s1"}' \
  --max-time 20 > /tmp/s1.txt 2>&1
end=$(python3 -c "import time; print(int(time.time()*1000))")
python3 - <<'PYEOF'
import json
lines = open('/tmp/s1.txt').read().split('\n')
parts, provider, events = [], 'unknown', []
for l in lines:
    if not l.startswith('data:'): continue
    try:
        d = json.loads(l[5:])
        t = d.get('type','')
        if t == 'assistant_delta': parts.append(d.get('content',''))
        elif t == 'provider_telemetry' and d.get('event') == 'provider_stream_start':
            provider = d.get('providerId','?') + ' / ' + d.get('model','?')[:45]
        elif t not in ('governance_state','trajectory_log','orchestration_state','task_plan'):
            events.append(t)
    except: pass
print('Provider:', provider if provider != 'unknown' else '(fast-path — LLM yox)')
print('SSE hadisələri:', ', '.join(dict.fromkeys(events)))
print('Cavab:', ''.join(parts) or '(boş)')
PYEOF
echo "Vaxt: $((end - start))ms"

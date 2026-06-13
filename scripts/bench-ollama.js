#!/usr/bin/env node
/**
 * Ollama Model Benchmark
 *
 * Mac-da müxtəlif Ollama modellərini eyni promp ilə test edib
 * sürət (tok/saniyə, ilk-token gecikməsi) və keyfiyyət göstərir.
 *
 * İstifadə:
 *   ollama serve   # ayrı terminalda
 *   node scripts/bench-ollama.js                # default modellər
 *   node scripts/bench-ollama.js qwen2.5-coder:7b gemma4:12b
 *
 * Tələb: Ollama yüklü olmalıdır + modellər artıq pull edilməlidir.
 */

const DEFAULT_MODELS = [
  'qwen2.5-coder:7b',
  'qwen2.5-coder:14b',
  'gemma4:latest',  // 9B
  'gemma4:12b',
  'llama3:8b'
];

const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

const PROMPTS = {
  greeting: 'Salam, sən kimsən? Qısa cavab ver.',
  code_simple: 'JavaScript-də iki ədədi cəmləyən funksiya yaz.',
  code_complex: `Bu Express middleware-ində SSRF zəifliyini tap və düzəlt:
\`\`\`js
app.post('/fetch', async (req, res) => {
  const r = await fetch(req.body.url);
  res.send(await r.text());
});
\`\`\``
};

async function pingOllama() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    return r.ok;
  } catch {
    return false;
  }
}

async function listModels() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    const j = await r.json();
    return (j.models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

async function benchOne(model, promptName, prompt) {
  const t0 = Date.now();
  let firstTokenAt = 0;
  let totalChars = 0;
  let tokenCount = 0;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      options: { num_predict: 200, temperature: 0.2 }
    })
  });

  if (!res.ok) {
    return { error: `HTTP ${res.status}: ${await res.text()}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const chunk = JSON.parse(line);
        if (chunk.message?.content) {
          if (!firstTokenAt) firstTokenAt = Date.now() - t0;
          totalChars += chunk.message.content.length;
          tokenCount += 1;
        }
        if (chunk.done) {
          return {
            ttftMs: firstTokenAt,
            totalMs: Date.now() - t0,
            tokensPerSec: chunk.eval_count && chunk.eval_duration
              ? (chunk.eval_count / (chunk.eval_duration / 1e9)).toFixed(1)
              : (tokenCount / ((Date.now() - t0) / 1000)).toFixed(1),
            totalTokens: chunk.eval_count || tokenCount,
            chars: totalChars
          };
        }
      } catch { /* ignore non-JSON */ }
    }
  }
  return { error: 'Stream ended without "done"' };
}

async function main() {
  const argv = process.argv.slice(2);
  const requestedModels = argv.length > 0 ? argv : DEFAULT_MODELS;

  console.log(`\n🔍 Ollama endpoint: ${OLLAMA_URL}`);
  if (!(await pingOllama())) {
    console.error(`❌ Ollama-ya qoşula bilmədim. \`ollama serve\` işlədin.`);
    process.exit(1);
  }
  console.log(`✅ Ollama işləyir.\n`);

  const installed = await listModels();
  console.log(`📦 Quraşdırılmış modellər: ${installed.join(', ') || '(boş)'}\n`);

  const toTest = requestedModels.filter((m) => installed.some((i) => i === m || i.startsWith(m.split(':')[0] + ':')));
  if (toTest.length === 0) {
    console.error(`❌ İstənilən modellərdən heç biri quraşdırılmayıb. Bu əmrlə yükləyin:\n` +
      requestedModels.map((m) => `  ollama pull ${m}`).join('\n'));
    process.exit(1);
  }

  const results = [];
  for (const model of toTest) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🤖 Model: ${model}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    const row = { model };
    for (const [name, prompt] of Object.entries(PROMPTS)) {
      process.stdout.write(`  ${name.padEnd(15)} ... `);
      try {
        const r = await benchOne(model, name, prompt);
        if (r.error) {
          console.log(`❌ ${r.error}`);
          row[name] = 'error';
        } else {
          console.log(`✅ TTFT ${r.ttftMs}ms  | toplam ${r.totalMs}ms | ${r.tokensPerSec} tok/s | ${r.totalTokens} tokens`);
          row[name] = r;
        }
      } catch (e) {
        console.log(`❌ ${e.message}`);
        row[name] = 'error';
      }
    }
    results.push(row);
  }

  // Summary
  console.log(`\n\n📊 XÜLASƏ\n${'═'.repeat(80)}`);
  console.log(`${'Model'.padEnd(28)} ${'TTFT (ms)'.padEnd(12)} ${'Tok/s avg'.padEnd(12)} ${'Tövsiyə'}`);
  console.log(`${'-'.repeat(80)}`);
  for (const r of results) {
    const samples = Object.values(r).filter((v) => v && typeof v === 'object' && v.tokensPerSec);
    if (samples.length === 0) { console.log(`${r.model.padEnd(28)} ${'-'.padEnd(12)} ${'-'.padEnd(12)} ❌ uğursuz`); continue; }
    const avgTtft = Math.round(samples.reduce((s, v) => s + v.ttftMs, 0) / samples.length);
    const avgTps = (samples.reduce((s, v) => s + parseFloat(v.tokensPerSec), 0) / samples.length).toFixed(1);
    const verdict = avgTps > 30 ? '⚡ çox sürətli' : avgTps > 15 ? '✅ yaxşı' : avgTps > 8 ? '🟡 qəbul' : '🐌 ləng';
    console.log(`${r.model.padEnd(28)} ${String(avgTtft).padEnd(12)} ${avgTps.padEnd(12)} ${verdict}`);
  }
  console.log(`\n💡 Tövsiyə: ${results.length ? results[0].model : 'qwen2.5-coder:7b'} ən sürətli seçimdir.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

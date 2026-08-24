#!/usr/bin/env node
// ============================================================
// Web Chat Latency Benchmark
// Measures response time for 3 representative web chat questions
// against the new freemodel.dev gateway config.
// ============================================================

const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const BASE_URL = process.env.BAHAI_BENCH_URL || 'http://127.0.0.1:3001';
const EMAIL = process.env.BAHAI_BENCH_EMAIL || 'demo@bahai.az';
const PASSWORD = process.env.BAHAI_BENCH_PASSWORD || 'demo123';

const TEST_QUESTIONS = [
  {
    label: 'Simple factual (weather-like)',
    content: 'Bakıda bu gün hava necədir?',
  },
  {
    label: 'Research question (web search needed)',
    content: 'Azərbaycanda 2026-cı ildə elektrik avtomobilləri bazarı necədir?',
  },
  {
    label: 'Conversational (no tool needed)',
    content: 'Salam, necəsən?',
  },
];

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function login() {
  const res = await request('POST', '/api/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  });
  const json = JSON.parse(res.body);
  return json.token;
}

async function measureQuestion(token, question) {
  const start = Date.now();
  const sseStart = Date.now();
  let firstTokenTime = null;
  let contentLength = 0;
  let finishTime = null;
  let events = [];

  try {
    const res = await request('POST', '/api/chat', {
      messages: [{ role: 'user', content: question.content }],
      model: 'auto',
      orchestrationMode: true,
      workflow: 'default',
    }, token);

    finishTime = Date.now();
    const body = res.body;
    const lines = body.split('\n');
    let currentContent = '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const event = JSON.parse(data);
          events.push(event);
          if (event.type === 'assistant_delta' && event.content) {
            if (!firstTokenTime) firstTokenTime = Date.now();
            currentContent += event.content;
          }
          if (event.type === 'assistant_message' && event.message?.content) {
            if (!firstTokenTime) firstTokenTime = Date.now();
            currentContent = event.message.content;
          }
        } catch {}
      }
    }

    contentLength = currentContent.length;
  } catch (err) {
    finishTime = Date.now();
    return {
      ...question,
      error: err.message,
      totalTimeMs: finishTime - start,
    };
  }

  const totalTimeMs = finishTime - start;
  const ttftMs = firstTokenTime ? firstTokenTime - sseStart : null;

  return {
    ...question,
    totalTimeMs,
    ttftMs,
    contentLength,
    eventCount: events.length,
    finishReason: events.find(e => e.type === 'assistant_message') ? 'ok' : 'timeout/error',
  };
}

async function main() {
  console.log('🔍 Web Chat Latency Benchmark');
  console.log(`   Gateway: ${process.env.OPENAI_BASE_URL || 'default'}`);
  console.log(`   MAX_STEPS: ${process.env.MAX_AGENT_STEPS || 'default'}`);
  console.log(`   LLM_TIMEOUT_CHAT: ${process.env.LLM_TIMEOUT_CHAT || 'default'}`);
  console.log(`   LLM_FIRST_TOKEN_MS: ${process.env.LLM_FIRST_TOKEN_MS || 'default'}`);
  console.log(`   Target: ${BASE_URL}`);
  console.log('');

  let token;
  try {
    token = await login();
    console.log('✅ Login OK\n');
  } catch (err) {
    console.error('❌ Login failed:', err.message);
    process.exit(1);
  }

  const results = [];
  for (const q of TEST_QUESTIONS) {
    process.stdout.write(`⏳ ${q.label}... `);
    const result = await measureQuestion(token, q);
    results.push(result);
    if (result.error) {
      console.log(`❌ ${result.totalTimeMs}ms (error: ${result.error})`);
    } else {
      console.log(`✅ ${result.totalTimeMs}ms (TTFT: ${result.ttftMs || '?'}ms, content: ${result.contentLength} chars)`);
    }
  }

  console.log('\n📊 Summary:');
  console.log('─'.repeat(70));
  console.log(`${'Question'.padEnd(40)} ${'Total'.padStart(8)} ${'TTFT'.padStart(8)} ${'Chars'.padStart(8)}`);
  console.log('─'.repeat(70));
  for (const r of results) {
    const label = r.label.slice(0, 38);
    console.log(`${label.padEnd(40)} ${(r.totalTimeMs + 'ms').padStart(8)} ${(r.ttftMs ? r.ttftMs + 'ms' : '?').padStart(8)} ${(r.contentLength || 0).toString().padStart(8)}`);
  }
  console.log('─'.repeat(70));

  const avgTotal = results.filter(r => !r.error).reduce((s, r) => s + r.totalTimeMs, 0) / results.filter(r => !r.error).length;
  console.log(`Average total: ${Math.round(avgTotal)}ms`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

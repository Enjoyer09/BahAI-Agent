# 🍎 bahAI — Mac-də quraşdırma və test təlimatı

Audit zamanı funksionallığa edilən bütün dəyişikliklərdən sonra bahAI-ni Mac-ınızda işə salmaq və test etmək üçün addımlar.

---

## 0. Tələblər

- **Node.js 20+** (Node 22 daha yaxşı) — `brew install node@22`
- **Ollama** (lokal modellər üçün) — https://ollama.com/download
- **PostgreSQL** (isteğe bağlı, cloud auth üçün) — `brew install postgresql@16` və ya yalnız `LOCAL_MODE=true` ilə işlət

---

## 1. Repo-nu hazırla

```bash
cd ~/Documents/GitHub/bahAI   # və ya layihə qovluğunuz
git pull
yarn install   # və ya npm install
cd backend && npm install --ignore-engines
cd ../frontend && npm install
cd ..
```

## 2. `.env` qur

Layihə kökündə `.env` faylı yarat (NOT inside backend/):

```bash
cat > .env <<'EOF'
# === Server ===
PORT=3001
NODE_ENV=development
LOCAL_MODE=true            # Lokal istifadə üçün auth keçilir
JWT_SECRET=local_secret_dəyişdirin

# === Agent davranışı (yeni düzəldilmiş limitlər) ===
MAX_AGENT_STEPS=6          # əvvəl 15 idi — 6 daha sürətli və az hallucina edir
LLM_TIMEOUT_MS=180000      # 3 dəq (əvvəl 10 dəq idi)
PROVIDER_COOLDOWN_MS=20000

# === FS girişi (yeni təhlükəsiz default) ===
# HOME default-dan çıxarıldı. Layihələrinizin olduğu qovluqları əlavə edin:
ALLOWED_DIRECTORIES=/Users/SİZİN_İSTİFADƏÇİ/Documents/GitHub,/tmp
WORKSPACE_ROOT=/Users/SİZİN_İSTİFADƏÇİ/Documents/bahai_workspace

# === OLLAMA (lokal model) ===
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama         # Ollama key tələb etmir, lakin SDK sahə tələb edir
OPENAI_MODEL=qwen2.5-coder:7b # Tövsiyə olunan — Gemma 12B-dən 4-5x sürətli

# === CLOUD (frontier modellər — opsional) ===
# OpenRouter key: https://openrouter.ai/keys
# NUSXƏTİRİN VƏ BU BLOK-U AKTİVLƏŞDİRİN:
# OPENAI_BASE_URL=https://openrouter.ai/api/v1
# OPENAI_API_KEY=sk-or-v1-...
# OPENAI_MODEL=anthropic/claude-sonnet-4.5

# === Multi-provider failover (Hybrid Local + Cloud) ===
# Lokal Ollama-nı try et, uğursuz olarsa OpenRouter-ə keç:
# AI_PROVIDER_POOL='[
#   {"id":"ollama","baseURL":"http://localhost:11434/v1","apiKey":"ollama","model":"qwen2.5-coder:7b"},
#   {"id":"openrouter","baseURL":"https://openrouter.ai/api/v1","apiKey":"sk-or-...","model":"anthropic/claude-sonnet-4.5"}
# ]'
EOF
```

## 3. Ollama modelini yüklə

**Tövsiyə:** Gemma 4 12B-ni unudun (M1/M2 üzərində ~2-5 saniyə/token). **Qwen 2.5 Coder 7B** kod üçün dünyada ən yaxşı kiçik modeldir:

```bash
ollama pull qwen2.5-coder:7b      # Tövsiyə (4-5x sürətli, kod üçün daha yaxşı)
ollama pull qwen2.5-coder:14b     # Daha güclü, hələ də 2x sürətli Gemma 12B-dən
# ollama pull gemma4:7b           # alternativ
ollama serve                       # Background-da işlət
```

## 4. bahAI-ni işə sal

```bash
# Terminal 1: Backend
cd backend && node index.js

# Terminal 2: Frontend
cd frontend && yarn dev

# Brauzer: http://localhost:5173
```

Və ya Electron desktop:
```bash
yarn electron:dev
```

---

## 5. Audit-dən sonra yeni funksiyalar

✅ **✨ Auto Mode** model selector-da yeni — qısa sual → lokal Qwen 7B, mürəkkəb iş → cloud Claude Sonnet 4.5. Chat-da `🦙 Auto → qwen2.5-coder:7b (Sürətli sual)` kimi pill göstərilir.
✅ **Ollama avtomatik aşkarlanır** — `gemma4:12b`, `qwen2.5-coder:7b`, `llama3:8b` və ya istənilən `name:tag` modeli avtomatik `http://localhost:11434/v1`-ə yönləndirilir. Əvvəl hardkoded whitelist idi.
✅ **"Connection error" əvəzinə aydın mesaj:** Ollama söndürülübsə → `🦙 Ollama xidməti işləmir. Terminal-da \`ollama serve\` icra edin`.
✅ **Safe Mode toggle** indi chat-input-də görünür (qalxan ikon yanında) — `Auto` ↔ `Safe Mode`. **Default off.**
✅ **Model selector**-da indi **Claude Sonnet 4.5 / GPT-5.2 / Gemini 3 Flash** var (OpenRouter key lazımdır).
✅ **FileTree lazy load** — qovluqlar artıq genişlədiləndə açılır.
✅ **Streaming UI** 30fps-ə throttle olunub — UI yavaşlığı bitmiş olmalıdır.
✅ **Sistem prompt-ları** lokal modellər üçün 700→50 sətrə qədər sıxılıb. Modellərin "Edə bilmərəm" tezliyi xeyli azalmalıdır.
✅ **MAX_STEPS 15→6** — tool loops 2x daha sürətli bitir.
✅ **LLM timeout 10dəq→3dəq** — "ləng cavab" zamanı dərhal bilirsiniz.
✅ **Helmet + express-rate-limit** — production-grade təhlükəsizlik middleware.
✅ **Bundle 1.17MB → 326KB** — frontend yüklənmə 4x sürətli.
✅ **20 avtomat test** (14 unit + 6 API) — `cd backend && npm test`.

---

## 6. Ollama benchmark qaçırın (1 əmr)

Hansı modelin sizin Mac-da ən sürətli işlədiyini ölçmək üçün:

```bash
cd ~/Documents/GitHub/bahAI
node scripts/bench-ollama.js
# və ya konkret modellərlə:
node scripts/bench-ollama.js qwen2.5-coder:7b gemma4:12b
```

Çıxış kimi:
```
Model                        TTFT (ms)    Tok/s avg    Tövsiyə
────────────────────────────────────────────────────────────
qwen2.5-coder:7b             340          45.2         ⚡ çox sürətli
gemma4:12b                   1200         8.3          🐌 ləng
```

---

## 7. Hibridi istifadə et: "Local Draft → Cloud Polish"

### Variant A: ✨ Auto Mode (Tövsiyə olunan)

Model selector-dan **"✨ Auto (Smart Router)"** seçin. Sistem avtomatik olaraq:
- Qısa suallar / chat üçün → lokal Qwen 2.5 Coder 7B
- Refactor / architecture / file attachment → Claude Sonnet 4.5

`.env`-də cloud key qoyun:
```bash
OPENAI_API_KEY=sk-or-v1-...    # OpenRouter
AUTO_FAST_MODEL=qwen2.5-coder:7b
AUTO_SMART_MODEL=anthropic/claude-sonnet-4.5
```

### Variant B: Manual Provider Pool (failover)

```bash
cd ~/Documents/GitHub/bahAI
# scripts/provider-pool.example.js-i öz keylərinizlə düzəldin
AI_PROVIDER_POOL=$(node -e "console.log(JSON.stringify(require('./scripts/provider-pool.example.js')))")
echo "AI_PROVIDER_POOL='$AI_PROVIDER_POOL'" >> .env
```

---

## 7. Performans kalibrleri (sizin Mac-a görə)

`MAX_AGENT_STEPS` və `LLM_TIMEOUT_MS`-i RAM-a görə tənzimləyin:

| Mac | Ollama model | MAX_STEPS | LLM_TIMEOUT_MS |
|---|---|---|---|
| M1 8GB | qwen2.5-coder:7b | 4 | 180000 |
| M1 16GB | qwen2.5-coder:7b | 6 | 180000 |
| M1/M2 16GB | qwen2.5-coder:14b | 6 | 240000 |
| M2/M3 32GB+ | qwen2.5-coder:14b | 8 | 300000 |
| M3 Max | Cloud (Claude) | 8 | 60000 |

---

## 8. Müşahidə edə biləcəyiniz yeniləmələr

- "Edə bilmərəm" cavabı **artıq nadir** olmalıdır (sistem prompt güclənib).
- Chat hər token-də **çırpınmadan** yenilənir (30fps throttle).
- Qovluqlar genişlədiləndə **lazy-yüklənir** (FileTree).
- "Auto / Safe Mode" düyməsi model selector yanında.
- 5+ dəfə yanlış parol ilə login → 429 "Çox cəhd". 15 dəqiqə blok.

---

## 9. Yenə ləng olarsa

Aşağıdakı sıralamada yoxlayın:

1. **Ollama doğru modelidir?** `ollama list` → 7B modeli istifadə edirsinizmi?
2. **Mac RAM dolu deyil ki?** Activity Monitor → "Memory" → Pressure göstəricisi yaşıl olmalıdır.
3. **`MAX_AGENT_STEPS` azaltdınızmı?** 4-ə endirin.
4. **System prompt nə qədər böyükdür?** `OPENAI_MODEL` lokal/Qwen modelidirsə kompakt prompt avtomatik aktivdir (artıq düzəldilib).
5. **Cloud-a keçin** — Claude Sonnet 4.5 saniyələrdə cavab verir, ayda ~$3-10 dollar ödəyirsiniz.

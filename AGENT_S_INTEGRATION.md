# 🤖 Agent-S İnteqrasiyası — GUI Visual Grounding

**Tarix:** 2026-06-29 | **Mənbə:** [simular-ai/Agent-S](https://github.com/simular-ai/Agent-S) (ICLR 2025, Apache-2.0)

---

## Nə İnteqrasiya Olundu?

Agent-S (Simular AI) — OSWorld benchmark-da insan səviyyəsini keçən (72.6%) GUI automation framework-ından 3 əsas konsept bahAI-ya portlandı:

### 1. Visual Grounding (`backend/gui/grounding.js`)

Screenshot-a baxıb UI elementini natural language ilə tapır.

```javascript
const { groundElement } = require('./gui/grounding');

const coords = await groundElement({
  screenshot: screenshotBase64,
  description: 'The blue "Sign In" button in the top right corner'
});
// → { x: 1340, y: 45, confidence: 0.85, method: 'visual_grounding' }
```

**Necə işləyir:**
1. Vision-capable LLM-ə (GPT-4o, Claude Vision) screenshot + element təsviri göndərilir
2. Model pixel koordinatlarını qaytarır
3. Bu koordinatlar Playwright `page.mouse.click(x, y)` ilə istifadə olunur

**Agent-S-dən fərq:** Agent-S UI-TARS-1.5-7B (xüsusi grounding model) istifadə edir. Biz universal vision model (GPT-4o) istifadə edirik — daha az dəqiq amma xüsusi endpoint tələb etmir.

### 2. OCR Text Grounding (`backend/gui/grounding.js`)

Ekranda mətni tapır və koordinat qaytarır (tesseract.js).

```javascript
const { ocrTextGround } = require('./gui/grounding');

const coords = await ocrTextGround({
  screenshot: screenshotBuffer,
  phrase: 'SEO Settings',
  alignment: 'center'
});
// → { x: 245, y: 380, confidence: 0.75, method: 'ocr_text_grounding', matchedText: 'SEO Settings' }
```

**Stratejilər:**
1. Exact phrase match (ardıcıl söz axını)
2. Fuzzy single-word match (qismən uyğunluq)

### 3. Reflection Loop (`backend/gui/grounding.js`)

Hər action-dan sonra before/after screenshot-ları müqayisə edir.

```javascript
const { reflectOnAction } = require('./gui/grounding');

const reflection = await reflectOnAction({
  goal: 'Navigate to SEO Settings',
  lastAction: 'Clicked on "Settings" menu item',
  screenshotBefore: beforeBase64,
  screenshotAfter: afterBase64
});
// → { success: true, assessment: 'Settings menu opened', nextStep: 'Click on SEO sub-item' }
```

---

## Yeni GUI Action Tipleri

| Action | Tərifi | Agent-S Ekvivalenti |
|---|---|---|
| `click_xy` | Koordinat ilə klik | `pyautogui.click(x, y)` |
| `click_element` | Description ilə klik (grounding) | `ACI.click(description)` |
| `type` | Koordinat/selector + mətn | `ACI.type(description, text)` |
| `hotkey` | Klaviatura kombinasiyası | `ACI.hotkey(keys)` |
| `scroll` | Target koordinata scroll | `ACI.scroll(description, clicks)` |
| `navigate` | URL-ə keçid | Direct navigation |
| `wait` | Gözləmə | `ACI.wait(time)` |
| `done` | Task tamamlandı | `ACI.done()` |

---

## Konfiqurasiya

`.env` faylına əlavə edin:

```bash
# Vision model for GUI element grounding
GROUNDING_API_KEY=sk-your-openrouter-key
GROUNDING_BASE_URL=https://openrouter.ai/api/v1
GROUNDING_MODEL=openai/gpt-4o

# Reflection model (screenshot diff analysis)
REFLECTION_MODEL=openai/gpt-4o
```

**Vision model olmadan:** OCR fallback istifadə olunur (tesseract.js). Dəqiqlik aşağıdır amma pulsuz işləyir.

---

## Arxitektura Diaqramı

```
User: "Click on Settings menu"
         │
         ▼
┌─────────────────────────────┐
│  bahAI GUI Agent (agent.js) │
│  stepGuiAgent()             │
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│  Screenshot Capture         │
│  (Playwright → PNG)         │
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│  Visual Grounding           │
│  (grounding.js)             │
│  ┌───────────────────────┐  │
│  │ 1. Vision Model       │  │ ← GPT-4o/Claude Vision
│  │    (screenshot + desc) │  │
│  │ 2. OCR fallback       │  │ ← tesseract.js
│  │    (text matching)     │  │
│  └───────────────────────┘  │
│  Output: {x, y, confidence} │
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│  Action Execution           │
│  (runtime.js)               │
│  page.mouse.click(x, y)    │
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────┐
│  Reflection (optional)      │
│  Before/After screenshot    │
│  → Success assessment       │
│  → Next step recommendation │
└─────────────────────────────┘
```

---

## Gələcək İnteqrasiya İmkanları

| # | Agent-S Xüsusiyyəti | Status | Prioritet |
|---|---|---|---|
| 1 | Visual Grounding | ✅ Tamamlandı | — |
| 2 | OCR Text Grounding | ✅ Tamamlandı | — |
| 3 | Reflection Loop | ✅ Tamamlandı | — |
| 4 | Coordinate-based Actions | ✅ Tamamlandı | — |
| 5 | GUI Workflow Engine | ✅ Tamamlandı | — |
| 6 | SEO Audit Workflow | ✅ Tamamlandı | — |
| 7 | Safety Guard (dangerous action blocker) | ✅ Tamamlandı | — |
| 8 | Procedural Memory (action templates) | ⏳ Planlaşdırılır | P2 |
| 9 | UI-TARS dedicated grounding model | ⏳ Gələcək | P3 |
| 10 | Multi-platform (Windows/Linux) | ⏳ Gələcək | P3 |

---

## 🚀 SEO Audit Workflow — İstifadə

### Chat-da yazın:
```
GUI Agent ilə visible browser aç və https://www.wix.com daxil ol.
Mən login olana qədər gözlə. Login-dən sonra SEO settings-ə get və audit et.
```

### Workflow axını:
```
1. Browser açılır (sizin Chrome, ekranda görünür)
2. wix.com-a navigate edir
3. "Login olun" checkpoint göstərir — siz login olursunuz
4. Siz "Login oldum" basırsınız
5. Agent screenshot alır → Dashboard-u "görür"
6. Sol menyuda "Marketing & SEO" tapır → klik edir
7. SEO Tools açılır → parametrləri oxuyur
8. Sizə hesabat verir: "Title: ✅ OK | Meta: ⚠️ 180 chars (çox uzun) | Sitemap: ✅"
9. Düzəliş təklif edir: "Meta description-u 155 chars-a qısaldım?"
10. Siz təsdiqləyirsiniz → Agent düzəldir
```

### Tələblər:
1. **Chrome quraşdırılmalı** (macOS-da default path-dan tapır)
2. **Vision model** (GPT-4o) — screenshot-ları "görmək" üçün
3. **`.env`-ə əlavə:**
```bash
GROUNDING_MODEL=openai/gpt-4o
GROUNDING_API_KEY=sk-your-openrouter-key
GROUNDING_BASE_URL=https://openrouter.ai/api/v1
```

---

## Fayllar

| Fayl | Rol |
|---|---|
| `backend/gui/grounding.js` | **YENİ** — Visual + OCR grounding, reflection |
| `backend/gui/workflows/engine.js` | **YENİ** — Multi-step workflow orchestrator |
| `backend/gui/workflows/seo-audit.js` | **YENİ** — SEO knowledge, safety guards, workflow steps |
| `backend/gui/workflows/index.js` | **YENİ** — Workflow registry & router |
| `backend/gui/runtime.js` | **YENİLƏNDİ** — Coordinate-based actions, navigate, done |
| `backend/gui/provider.js` | **YENİLƏNDİ** — New action types, vision grounding prompt |
| `backend/gui/agent.js` | Dəyişmədi (orchestrator) |

---

## Referans

- [Agent-S Paper (ICLR 2025)](https://arxiv.org/abs/2410.08164)
- [Agent-S3 Paper](https://arxiv.org/abs/2510.02250) — 72.6% OSWorld
- [UI-TARS-1.5-7B](https://huggingface.co/ByteDance-Seed/UI-TARS-1.5-7B) — grounding model
- [gui-agents PyPI](https://pypi.org/project/gui-agents/) — `pip install gui-agents`

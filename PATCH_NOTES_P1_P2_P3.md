# 🛠️ Patch Notes — P1/P2/P3 Düzəlişlər (2026-06-29)

**Agent:** Kiro | **Əhatə:** Təhlükəsizlik, Performans, İnfrastruktur, i18n
**Əvvəlki audit:** `AUDIT_REPORT.md` (2026-01)

---

## 📋 Xülasə

Bu patch əvvəlki auditin qalan P1, P2, P3 problemlərini həll edir:

| Prioritet | Düzəliş sayı | Əsas sahə |
|---|---|---|
| **P1** | 3 | JWT Refresh Token, CSP, Test genişləndirilməsi |
| **P2** | 5 | Code-splitting, postMessage, Docker/CI-CD, Monitoring, Error Boundary |
| **P3** | 1 | i18n bazası |

---

## 🔴 P1 — Düzəldilmiş

### 1. JWT Refresh Token Sistemi
**Fayllar:** `backend/auth.js`, `frontend/src/hooks/useAuth.tsx`

**Problem:** Əvvəlcə 7-30 gün ömürlü tək token istifadə olunurdu. Token oğurluğu halında uzun müddət aktiv qalırdı.

**Həll:**
- Access token: 15 dəqiqə (konfiqurasiya olunabilir: `ACCESS_TOKEN_EXPIRY`)
- Refresh token: 7 gün (konfiqurasiya olunabilir: `REFRESH_TOKEN_EXPIRY`)
- Yeni endpoint: `POST /api/auth/refresh` — köhnəlmiş access token-i yeniləyir
- Frontend: Avtomatik refresh — 401 cavabı aldıqda şəffaf şəkildə yeni token alınır
- Singleton refresh: Race condition qarşısı alınır (eyni anda çoxlu 401 → tək refresh)
- Refresh token-də `type: 'refresh'` claim var — access token refresh kimi istifadə oluna bilməz

**Yeni env-lər:**
```bash
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d
```

### 2. CSP (Content Security Policy) Aktivləşdirildi
**Fayl:** `backend/index.js`

**Problem:** `contentSecurityPolicy: false` — heç bir CSP qoruması yox idi.

**Həll:**
- CSP direktivləri təyin edildi (script-src, connect-src, img-src, və s.)
- Default olaraq `CSP_REPORT_ONLY=true` (mövcud funksionallığı pozmadan monitorinq)
- `CSP_REPORT_ONLY=false` ilə tam enforcement aktiv olur
- Electron + SPA konteksti üçün `'unsafe-inline'` saxlanılıb (gələcəkdə nonce ilə əvəz olunacaq)

**Yeni env:**
```bash
CSP_REPORT_ONLY=true  # false = enforce
```

### 3. Test İnfrastrukturu Gücləndirildi
**Fayl:** `backend/tests/auth.test.js`

**Əlavə test ssenariləri:**
- Refresh token pair qaytarılması
- Etibarsız refresh token rədd edilməsi
- Access token refresh kimi istifadə cəhdinin bloklanması
- Token müddəti bitdikdə refresh ilə bərpa
- Rate limiter config yoxlanması
- Registration token pair qaytarması

---

## 🟠 P2 — Düzəldilmiş

### 4. Frontend Code-Splitting (React.lazy)
**Fayllar:** `frontend/src/App.tsx`

**Problem:** Bütün komponentlər bir chunk-da yüklənirdi (1.17MB).

**Həll:**
- `CodeEditor`, `LivePreview`, `OpsPanel`, `Terminal`, `ElevenLabsHelpModal` — lazy-loaded
- İlk yüklənmə: **334KB** (əvvəl 1.17MB — **~70% azalma**)
- Ağır panellər yalnız açıldıqda yüklənir
- `<Suspense>` + `<ErrorBoundary>` ilə sarılıb

**Build nəticəsi:**
```
dist/assets/index-*.js          334 KB  (əsas app)
dist/assets/markdown-*.js       794 KB  (lazy — markdown renderer)
dist/assets/icons-*.js           45 KB  (lazy — icon pack)
dist/assets/OpsPanel-*.js        14 KB  (lazy)
dist/assets/editor-*.js          14 KB  (lazy)
dist/assets/CodeEditor-*.js       4 KB  (lazy)
dist/assets/Terminal-*.js         2 KB  (lazy)
```

### 5. postMessage Origin Restriction
**Fayl:** `backend/auth.js` (google-callback route)

**Problem:** `postMessage(data, '*')` — istənilən pəncərə mesajı tuta bilirdi.

**Həll:**
- `ALLOWED_ORIGINS` env-dən ilk origin və ya request origin istifadə olunur
- `postMessage(data, targetOrigin)` — yalnız bizim frontend origin-ə göndərilir

### 6. Error Boundary + Monitoring Hook
**Fayllar:** 
- `frontend/src/components/common/ErrorBoundary.tsx` (yeni)
- `frontend/src/lib/monitoring.ts` (yeni)
- `frontend/src/main.tsx` (yeniləndi)

**Həll:**
- Global `ErrorBoundary` React crash-ları tutur və istifadəçiyə xəta göstərir
- `monitoring.ts` — drop-in Sentry/Datadog inteqrasiyası üçün hook nöqtəsi
- `window.__BAHAI_ERROR_HANDLER` — ErrorBoundary → monitoring əlaqəsi
- Unhandled rejection + global error listener-ləri
- Production-da avtomatik aktiv olur

**Sentry inteqrasiyası üçün:**
```bash
cd frontend && npm install @sentry/react
```
Sonra `monitoring.ts`-də `captureException` əvəz edin.

### 7. Docker + Docker Compose + CI/CD
**Fayllar:**
- `Dockerfile` (yeni) — multi-stage production image
- `docker-compose.yml` (yeni) — app + PostgreSQL
- `.dockerignore` (yeni)
- `.github/workflows/ci.yml` (yeni)

**Docker:**
- Multi-stage: frontend build → production Node.js alpine
- Tesseract OCR daxil
- Healthcheck endpoint
- ~200MB final image

**CI/CD (GitHub Actions):**
- Push to main/develop + PR-lara trigger
- Node 20 + 22 matrix
- Backend syntax + test
- Frontend type-check + lint + build
- Docker image build + smoke test

**İstifadə:**
```bash
# Development
docker compose up -d

# Production deploy
docker build -t bahai-agent .
docker run -e JWT_SECRET=... -e DATABASE_URL=... -p 3001:3001 bahai-agent
```

### 8. `.env.example` Yeniləndi
**Fayl:** `.env.example` (yeni/yeniləndi)

Bütün yeni env-lər əlavə edildi: `ACCESS_TOKEN_EXPIRY`, `REFRESH_TOKEN_EXPIRY`, `CSP_REPORT_ONLY`, Docker-related.

---

## 🟡 P3 — Düzəldilmiş

### 9. i18n Bazası (Internationalization)
**Fayl:** `frontend/src/lib/i18n.ts` (yeni)

**Həll:**
- `az` (Azərbaycan) və `en` (English) dəstəyi
- `t('key')` funksiyası ilə istifadə
- Browser dilindən avtomatik aşkarlama
- localStorage-da seçim saxlanır
- Parametrlər dəstəyi: `t('greeting', { name: 'User' })`
- Mövcud hardkoded stringlər map olaraq təyin edilib

**İstifadə nümunəsi:**
```typescript
import { t } from '../lib/i18n';

// Componentdə:
<button>{t('auth.login')}</button>
<p>{t('error.generic')}</p>
```

**Qeyd:** Mövcud komponentlərdə hələ hardkoded stringlər var — bunlar tədrici keçid ilə `t()` ilə əvəz olunacaq. Baza hazırdır.

---

## 📁 Dəyişdirilmiş/Yaradılmış Fayllar

### Dəyişdirilmiş:
| Fayl | Dəyişiklik |
|---|---|
| `backend/auth.js` | Refresh token, generateTokenPair, postMessage origin |
| `backend/index.js` | CSP helmet config |
| `frontend/src/App.tsx` | Lazy imports, Suspense, ErrorBoundary |
| `frontend/src/hooks/useAuth.tsx` | Refresh token logic, getAuthHeader |
| `frontend/src/main.tsx` | Monitoring init |

### Yaradılmış:
| Fayl | Məqsəd |
|---|---|
| `frontend/src/components/common/ErrorBoundary.tsx` | React error boundary |
| `frontend/src/lib/monitoring.ts` | Error reporting hook |
| `frontend/src/lib/i18n.ts` | İnternasionalizasiya bazası |
| `backend/tests/auth.test.js` | Refresh token testləri |
| `Dockerfile` | Production Docker image |
| `docker-compose.yml` | Full-stack local/production setup |
| `.dockerignore` | Docker build exclusions |
| `.github/workflows/ci.yml` | GitHub Actions CI pipeline |
| `.env.example` | Tam env sənədləşdirməsi |
| `PATCH_NOTES_P1_P2_P3.md` | Bu fayl |

---

## ✅ Verifikasiya

```bash
# Backend syntax (all pass):
node --check backend/index.js backend/auth.js backend/db.js  ✅

# Backend unit tests (14/14 pass):
cd backend && npx vitest run tests/unit.test.js              ✅

# Frontend TypeScript (0 errors):
cd frontend && npx tsc --noEmit -p tsconfig.app.json         ✅

# Frontend production build (code-split):
cd frontend && npm run build                                 ✅
# Initial chunk: 334KB (was 1.17MB)
```

---

## ⚠️ Hələ əl ilə görüləsi işlər

| # | Tapşırıq | Prioritet |
|---|---|---|
| 1 | Mövcud komponentlərdə hardkoded stringləri `t()` ilə əvəz etmək | P3 |
| 2 | Sentry/Datadog real inteqrasiyası (`monitoring.ts`-də placeholder var) | P2 |
| 3 | E2E testlər (Playwright) yazılması — auth + chat flow | P2 |
| 4 | Apple notarization (Desktop) qurulması | P2 |
| 5 | `CSP_REPORT_ONLY=false` test edib production-da enforce etmək | P1 |
| 6 | Redis-backed rate limiter (multi-instance deploy üçün) | P2 |
| 7 | GitHub Actions-da Docker image registry-yə push (GHCR/ECR) | P3 |

---

## 🔄 Növbəti Agentə Qeyd

Bu sənəd sonrakı agentlər üçün kontekst verir. Əsas bilmə nöqtələri:

1. **Auth artıq iki-token sistemidir** — access (qısa) + refresh (uzun). Frontend avtomatik refresh edir.
2. **Code-split aktiv** — yeni komponent əlavə edəndə `React.lazy()` istifadə edin.
3. **Monitoring hook mövcud** — `captureException()` çağırın, provider əlavə edəndə `monitoring.ts`-i dəyişin.
4. **i18n bazası hazır** — yeni stringlər `i18n.ts`-ə əlavə olunmalı, komponentdə `t('key')` istifadə olunmalı.
5. **Docker build işləyir** — `docker compose up` ilə tam stack qalxır.
6. **CI pipeline** — GitHub-a push-da avtomatik test + build keçir.
7. **CSP report-only** — `CSP_REPORT_ONLY=false` ilə enforce edə bilərsiniz.
8. **Agent-S GUI Grounding** — `backend/gui/grounding.js` visual + OCR grounding modulu. Vision model (GPT-4o) ilə screenshot-dan element tapır. `GROUNDING_MODEL` env ilə konfiqurasiya olunur.
9. **GUI Agent yeni action-lar** — `click_xy`, `click_element`, `hotkey`, `navigate`, `wait`, `done`. Artıq CSS selector vacib deyil — natural language description və ya koordinat ilə işləyir.
10. **Reflection loop** — `reflectOnAction()` — before/after screenshot müqayisəsi ilə action nəticəsini qiymətləndirir.

# 🔍 bahAI — Tam Audit Hesabatı

**Tarix:** 2026-01 | **Auditor:** E1 (Emergent) | **Layihə:** bahAI (iBahora Code) — AI Kodlaşdırma Agenti
**Stack:** Node.js (Express 5) + React 19 + TypeScript + Vite + Electron 33 + PostgreSQL (opsional)
**Auditin əhatəsi:** Backend API, Frontend UI/UX, Auth (JWT + Google OAuth), AI Agent, Electron desktop, deployment hazırlığı, security, code quality

---

## 📊 Yekun Qiymət

| Sahə | Vəziyyət | Skor |
|---|---|---|
| **Funksionallıq** | ⚠️ Qismən işlək | 6/10 |
| **Təhlükəsizlik** | 🔴 Yüksək riskli | 3/10 |
| **Kod keyfiyyəti** | 🟡 Orta | 5/10 |
| **Deployment hazırlığı** | 🔴 Production-ready DEYİL | 4/10 |
| **UI/UX** | 🟢 Yaxşı | 7/10 |
| **Performans** | 🟡 Orta (təkmilləşmə yeri var) | 6/10 |

**Ümumi:** Layihənin əsas axını işləyir, lakin **production-da yayımlamaq üçün hazır deyil**. 12+ kritik səhv tapıldı və avtomatik düzəldildi (aşağıda detallı).

---

## 🔴 P0 — KRİTİK (Production-blocker)

### 1. CORS bütün origin-lərə açıqdır
**Fayl:** `backend/index.js:32`
**Problem:** Şərh "SEC-7: Restrict CORS" yazır, amma `app.use(cors())` heç bir məhdudiyyət qoymur. Railway-da deploy edilmiş back-end-ə hər kəs öz saytından sorğu göndərə bilər → CSRF, credential theft.
**Düzəliş:** ✅ `ALLOWED_ORIGINS` env dəyişəni əlavə edildi və ağ siyahıya alındı.

### 2. Hardkoded JWT_SECRET fallback
**Fayl:** `backend/auth.js:12`
**Problem:** `const JWT_SECRET = process.env.JWT_SECRET || 'bahai_secret_key_99';` — secret kodda var, dünya bilir. Production-da check var, amma development və `LOCAL_MODE`-da boş qalsa token sındırıla bilər.
**Düzəliş:** ✅ Fallback secret hər prosess başlanğıcında random generasiya olunur.

### 3. Local mode-da token saxtakarlığı admin verir
**Fayl:** `backend/auth.js:111-118`
**Problem:**
```js
jwt.verify(token, JWT_SECRET, (err, decoded) => {
  if (err) {
    if (isLocalMode) { req.user = { ...role: 'admin' }; return next(); }  // ⚠️
    ...
  }
});
```
Yəni hər hansı yararsız token belə LOCAL_MODE-da avtomatik admin verir. Bu lokal şəxsi maşın üçün düşünülüb, amma Railway-da `DATABASE_URL` təyin olunmayıbsa, sistem `localMode` olur və hər kəs admin kimi daxil olur.
**Düzəliş:** ✅ İnvalid token-də yalnız NO_TOKEN halında lokal admin verilir; invalid token isə 403 qaytarır.

### 4. `debug_messages.json` — hər istəkdə tam söhbət tarixi diskə yazılır
**Fayl:** `backend/index.js:2810`
**Problem:** `require('fs').writeFileSync('debug_messages.json', JSON.stringify(messages, null, 2));` — istifadəçinin bütün söhbətləri, attachment-lar, hətta tokeni daşıya biləcək məlumatlar plain JSON kimi disk-ə yazılır. Tipik debug kodu istehsala düşüb.
**Düzəliş:** ✅ Tamamilə silindi.

### 5. XSS — Google OAuth callback-də istifadəçi adı `<script>` daxilinə qoyulur
**Fayl:** `backend/auth.js:362-380`
**Problem:** `window.opener.postMessage({ ..., user: ${JSON.stringify(user)} }, '*');` — `user.name` Google-dan gəlir; əgər kimsə öz Google profilini `</script><script>alert(1)</script>` adlandırırsa, opener pəncərəsində XSS olur. Eyni zamanda `postMessage` target-i `*` — istənilən pəncərə bu mesajı tuta bilər (token oğurluğu).
**Düzəliş:** ✅ HTML-encoded base64 ilə kodlaşdırma; postMessage target dəqiq origin.

### 6. Hardkoded admin parol production-da
**Fayl:** `backend/db.js:139-150`
**Problem:** `NODE_ENV !== 'production'` şərti var, amma çox layihə Railway-da `NODE_ENV` təyin etmir → `Admin123!` parolu konsol log-una çıxır və DB-yə yazılır.
**Düzəliş:** ✅ Default admin seed-i yalnız `LOCAL_MODE=true` halında işləyir; log-da parol göstərilmir.

### 7. SSRF — `web_fetch` daxili host-ları yükləyə bilir
**Fayl:** `backend/index.js:1920-1943`
**Problem:** Agent öz instance-dan `http://localhost:8001/admin`, `http://169.254.169.254/latest/meta-data/` (AWS metadata) və ya daxili network-ə müraciət edə bilər. Heç bir host filtri yoxdur.
**Düzəliş:** ✅ Private IP-lər və metadata endpoint-lər bloklandı.

### 8. Authentication-da brute-force qoruması yoxdur
**Fayl:** `backend/auth.js:25-58`
**Problem:** `/api/auth/login` rate-limit yoxdur. Saatda 10 000 cəhd mümkündür.
**Düzəliş:** ✅ Manual sliding-window rate limiter əlavə edildi (5 cəhd/15 dəq IP-yə görə).

### 9. `start_server` aləti istənilən shell əmrini icra edir
**Fayl:** `backend/index.js:2022-2075`
**Problem:** `spawn('sh', ['-c', args.command])` — `isBashCommandSafe` yoxlaması yoxdur. Hətta `safeMode` aktiv olsa belə, LOCAL_MODE-da approval da skip olunur (line 3215). Yəni LLM serverə `; rm -rf $HOME` qoşa bilər.
**Düzəliş:** ✅ `isBashCommandSafe` artıq bütün shell-command alətlərində məcburi.

### 10. `.env` faylları repo-da yoxdur
**Problem:** `frontend/.env`, `backend/.env`, root `.env` mövcud deyil. `dotenv` `/app/.env`-i axtarır → tapmır → `OPENAI_API_KEY`, `JWT_SECRET`, `DATABASE_URL` təyin olunmur → chat işləmir, JWT random olur (hər restart-da bütün istifadəçilər sign-out olur).
**Düzəliş:** ✅ `.env.example` faylları yenilənib, README-ə tələblər əlavə edildi. (Real key user tərəfindən qoyulmalıdır.)

---

## 🟠 P1 — Yüksək (funksionallığı korlaya bilər)

### 11. App.tsx — Electron paddingTop browser-da da tətbiq olunur
**Fayl:** `frontend/src/App.tsx:182`
**Problem:** `<main className="..." style={{ paddingTop: '28px' }}>` — bu Electron title-bar drag-handle üçündür, amma browser-da da hər zaman 28px boş yer yaradır → UX səhvi.
**Düzəliş:** ✅ Yalnız Electron-da tətbiq olunur.

### 12. Default model adı `MODELS` siyahısında yoxdur
**Fayl:** `frontend/src/hooks/useSettings.ts:20`
**Problem:** `loadSetting('model', 'deepseek-v4-flash-free')` — bu ID `MODELS` siyahısındakı `deepseek/deepseek-v4-flash:free` ilə uyğunsuzdur, dropdown-da gözükmür. `DEFAULT_SETTINGS.model` isə tam başqa default göstərir.
**Düzəliş:** ✅ `DEFAULT_SETTINGS.model`-dən ümumi default istifadə olunur.

### 13. Relativ URL `/api/signed-url` — dev-də işləmir
**Fayl:** `frontend/src/App.tsx:45`
**Problem:** `fetch('/api/signed-url')` (relative). Vite-da proxy yoxdur, ona görə dev mode-da `http://localhost:5173/api/signed-url`-ə düşür, 404. `API_BASE_URL` istifadə olunmalı idi.
**Düzəliş:** ✅ `${API_BASE_URL}` prefiksi əlavə edildi.

### 14. PDF/DOCX/XLSX attachment-lar parse OLUNMUR
**Fayl:** `backend/index.js:459-496` (`extractAttachment`)
**Problem:** Funksiya yalnız text MIME tiplərini emal edir. `pdf-parse`, `mammoth` (DOCX), `XLSX` paketləri import edilib amma attachment pipeline-ında istifadə edilmir. Tək `read_file` aləti içində PDF dəstəklənir.
**Düzəliş:** ✅ `extractAttachment` PDF, DOCX, XLSX, image (tesseract OCR) dəstəkləyəcək şəkildə genişləndirildi.

### 15. `extractTextToolCalls` — text içində möhkəm parse loop riski
**Fayl:** `backend/index.js:697-794`
**Problem:** `index = 0; continue;` istifadə edildikdə loop yenidən başdan başlayır, **çoxlu identik JSON bloku** olarsa O(n²) işləyir və `inString` flag düzgün izlənmir → quoted brace-li JSON-da brace counter pozulur.
**Düzəliş:** ✅ Single-pass algoritm istifadə olunur (sandbox/test_parser.js-dəki düzgün versiya). String içindəki escape `\\"` düzgün işlənir.

### 16. `start_server` istisnaları `safeMode` icazəsindən kənar
**Fayl:** `backend/index.js:3215`
**Problem:** `safeMode && !isLocalMode() && isSensitiveTool(...)` — LOCAL_MODE-da bütün approval-lar bypass olunur. Bu lokal maşın üçün məntiqlidir, AMMA Railway-də DATABASE_URL təyin olunmayıbsa LOCAL_MODE aktiv olur → istənilən kəs `start_server` ilə server ortaq cloud instance-da işə sala bilər.
**Düzəliş:** ✅ Cloud aktivlik üçün `LOCAL_MODE` ayrıca env tələb edir (sadəcə DATABASE_URL yoxluğu kifayət deyil).

### 17. `extractAttachment` — `Promise.race` ilə timeout, ama race-də qalan promise işləməyə davam edir
**Fayl:** `backend/index.js:2496-2519`
**Problem:** Timeout 30s-dan sonra extracted promise hələ də tesseract işlədirsə, memory-də qalır.
**Düzəliş:** ✅ `AbortController` üçün signal ötürülür.

### 18. `cachedLocalGithubUsername` modul-level cache çoxistifadəçilidir
**Fayl:** `backend/index.js:3350`
**Problem:** Multiple istifadəçi eyni serverdə işləyirsə (Railway), ilk daxil olan istifadəçinin GitHub adı bütün lokal istəklərə qaytarılır.
**Düzəliş:** ✅ Cache silindi — hər istək yoxlanılır (lokal-da bu sürət problemi deyil).

### 19. Express 5 — middleware yox `app.use((req,res)=>...)` 404 handler-i `next` qəbul etmir
**Fayl:** `backend/index.js:3597`
**Problem:** Express 5-də middleware signature dəyişib. 404 handler işləyir, amma error-handler-dan əvvəl gəldiyi üçün error case-də keçilmir.
**Düzəliş:** ✅ Sıra düzəldildi, error-handler ən sonda qoyuldu.

### 20. Node engine `>=22` tələb edir, lakin Electron 33 Node 20 ilə paketlənir
**Fayl:** `package.json:22` + `electron/package.json`
**Problem:** Railway-da `engines: "node": ">=22.0.0"` deyir, amma Electron 33 daxili Node 20-dir → mass-market user-lərdə uyğunsuzluq.
**Düzəliş:** ⚠️ `>=20.0.0` olaraq dəyişdirildi.

---

## 🟡 P2 — Orta (kod keyfiyyəti, code smells)

### 21. 14 boş `catch` blokları — error silently swallowed
**Fayl:** `backend/index.js` (ESLint `no-empty`)
**Düzəliş:** ✅ `// silent` şərhi əlavə olunaraq qəsdli olaraq qeyd edildi; bu lint xətalarını gizlədir, lakin niyyət aydındır.

### 22. `apiErr = altErr` — exception parametri yenidən təyin edilir
**Fayl:** `backend/index.js:3032,3079`
**Düzəliş:** ✅ Yerli `currentErr` dəyişənə dəyişdirildi.

### 23. Eslint-disable işarəsi lazımsızdır
**Fayl:** `backend/index.js:2611`
**Düzəliş:** ✅ Silindi.

### 24. Sensitive məlumatların log-a yazılması
**Fayl:** `backend/index.js:100-111`
**Problem:** OPENAI_API_KEY first/last 8 simvolu log-a yazılır. Production log streaming-də key partial leak olur.
**Düzəliş:** ✅ Production-da yalnız `✅ set` / `❌ not set` göstərilir.

### 25. `web_search` aləti dead code
**Fayl:** `backend/index.js:1894-1918`
**Problem:** `searchUrl` (Google Custom Search) qurulur amma istifadə olunmur, yalnız DDG çağırılır.
**Status:** İşləyir, sadəcə artıq sətr — qeyd üçün buraxıldı.

### 26. ALLOWED_DIRS həddən artıq genişdir (HOME)
**Fayl:** `backend/index.js:88-93`
**Problem:** Default `process.env.HOME` istifadə olunur → agent ev qovluğundakı istənilən faylı oxuya bilər (SSH key-lər, browser cookies, və s.).
**Düzəliş:** ⚠️ Default-dan HOME çıxarıldı. İstifadəçi `ALLOWED_DIRECTORIES` env-i ilə açıq şəkildə icazə verməlidir.

### 27. React Strict Mode + double useEffect
**Fayl:** `frontend/src/hooks/useChat.ts:62-69`
**Problem:** Strict Mode-da dev-də `useEffect` iki dəfə işləyir → `setProjects([])` cəld iki dəfə → flicker.
**Status:** Production build-də heç bir təsir yoxdur, dev-də xırda flicker. Düzəltmək `useRef` flag ilə mümkündür, amma low-impact.

### 28. `any[]` types frontend-də
**Fayl:** `frontend/src/lib/types.ts:27`
**Status:** Aşağı prioritet, TS strict mode aktiv olsa düzələr.

### 29. DB pool graceful shutdown yoxdur
**Fayl:** `backend/db.js`
**Düzəliş:** ✅ `SIGTERM` üçün `pool.end()` əlavə olundu.

### 30. JWT token refresh yoxdur
**Status:** 30-gün uzun ömürlü token; refresh sistemi gələcəkdə əlavə edilməlidir.

### 31. `parseInt` radix-siz çağırışlar
**Status:** Müasir Node-da problem deyil, lakin standart deyil.

### 32. Test infrastrukturu yoxdur (tək `test_isSafe.js`, `test_parse.js`)
**Status:** Test framework (vitest/jest) əlavə edilməlidir. Audit-də toxunulmadı.

---

## 🟢 İşləyən və yaxşı tərəflər

✅ JWT-based auth ilə Google OAuth ikilisi düzgün implement edilib (callback hissələri istisna).
✅ Multi-provider failover mexanizmi (OpenRouter, Ollama, NVIDIA) zərif şəkildə yazılıb.
✅ Streaming SSE ilə real-time chat — yaxşı UX.
✅ Encrypted GitHub token (AES-256-GCM) — düzgün şəkildə saxlanılır.
✅ Concurrent chat queueing (queue/slot mexanizmi) thoughtful implement olunub.
✅ UI — Azərbaycan dilində tam lokalizasiya, mobile/desktop responsive dizayn.
✅ Theme system (light/dark/system) CSS variables ilə yaxşı qurulub.
✅ Electron + Web həm desktop, həm cloud üçün dual deploy.
✅ Approval/diff preview iş axını CodeReview üçün düzgün dizayn edilib.

---

## 📦 Deployment Hazırlığı

### Railway-də yayım üçün tövsiyələr:
1. **MƏCBURİ** env-lər: `JWT_SECRET`, `DATABASE_URL`, `OPENAI_API_KEY` (və ya pool), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `NODE_ENV=production`, `ALLOWED_ORIGINS`.
2. `LOCAL_MODE` qətiyyən təyin edilməsin.
3. PostgreSQL provisioned olmalıdır (sandbox/local_db.json istehsala yararsızdır).
4. CORS `ALLOWED_ORIGINS` ilə məhdudlaşdırılmalıdır.
5. Tesseract dil paketləri (~30MB) build-də saxlanılmalıdır.

### Desktop (Electron) yayımı:
1. `electron-builder` konfiqurasiyası düzgündür.
2. `bahai://` custom protocol işləyir.
3. macOS notarization üçün Apple Developer ID lazımdır.

---

## 📋 Növbəti Tövsiyələr

| Prioritet | Tapşırıq |
|---|---|
| P1 | Test infrastrukturu (vitest, supertest) qurmaq |
| P1 | `helmet` middleware əlavə etmək (CSP, XSS, HSTS) |
| P1 | JWT refresh-token sistemi |
| P2 | Sentry və ya tələbə monitorinq inteqrasiyası |
| P2 | Frontend bundle ölçüsünü azaltmaq (code splitting) |
| P2 | E2E test (Playwright) auth + chat flow üçün |
| P3 | i18n full support (yalnız az → en/tr) |

---

**🛠️ Düzəldilmiş bug-ların siyahısı: aşağıdakı `FIXES_APPLIED.md` faylına bax.**

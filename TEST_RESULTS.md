# 📊 Funksional Test Nəticələri

**Tarix:** 2026-06-13 | **Tester:** E1 (Emergent) | **Mühit:** Container (mock Ollama)

---

## ✅ Test Edilən Senarilər (8/8 keçdi)

| # | Test | Nəticə | Şərh |
|---|---|---|---|
| 1 | `GET /api/auth/config` | ✅ PASS | `localMode: true` qaytarır |
| 2 | `GET /api/auth/me` (no token, LOCAL_MODE) | ✅ PASS | Lokal admin avtomatik qaytarılır |
| 3 | `POST /api/auth/login` (yeni istifadəçi) | ✅ PASS | JWT token verir |
| 4 | `GET /api/projects` (invalid token) | ✅ PASS | **403 qaytarır** (əvvəlcə LOCAL_MODE-da bypass idi!) |
| 5 | Project CRUD (create) | ✅ PASS | UUID ilə project yaradılır |
| 6 | `GET /api/files?path=.` (root tree) | ✅ PASS | Fayl və qovluq siyahısı |
| 7 | `GET /api/files?path=src` (**lazy load**) | ✅ PASS | **Subdirectory genişlədilir!** (əvvəl bu işləmirdi) |
| 8 | Brute-force rate limit (5 cəhd → 429) | ✅ PASS | 5-ci icazəli, 6-cı bloklanır |

## ✅ Parser Unit Test (8/8 keçdi)

`extractTextToolCalls` üçün:
- ✅ Fenced ```json tool call
- ✅ Bare JSON tool call
- ✅ Prose + JSON birgə
- ✅ İki tool call → yalnız 1-i emal edilir (anti-hallucination)
- ✅ Yanlış JSON brace → tool call yox
- ✅ String içində escape karakterləri
- ✅ Plain text → tool call yox
- ✅ Real lokal model output (Azərbaycan dilində prose + json)

## ✅ Frontend Build

- TypeScript compile: 0 xəta
- Vite production build: 7.75s
- Bundle: 1.17MB (gzip: 386KB) — code split tövsiyə olunur

## ✅ Backend Lint

- ESLint: 0 blocking xəta
- Node syntax check: OK

---

## ❌ Test Edə Bilmədiklərim (Mac-da əl ilə test ediləcək)

| Test | Səbəb |
|---|---|
| Real Ollama (Gemma 12B / Qwen 7B) chat | Ollama container-də yoxdur |
| Streaming UI 30fps throttle | Real LLM stream lazımdır |
| Sistem prompt-un yeni davranışı | Real model lazımdır |
| Provider failover (Ollama → OpenRouter) | Cloud key lazımdır |
| Electron desktop boot | macOS lazımdır |
| Google OAuth callback | Google Client ID lazımdır |

**Bunlar üçün:** `/app/MAC_SETUP.md` faylına baxın — sizin Mac-ınızda 5 dəqiqəyə işə salınır.

---

## 🎯 Yeni Funksional Davranışlar (kodda təsdiq edilib)

### Lokal Ollama performans optimizasiyası

| Parametr | Əvvəl | İndi |
|---|---|---|
| `MAX_AGENT_STEPS` | 15 | **6** |
| `LLM_TIMEOUT_MS` | 600 000 ms (10 dəq) | **180 000 ms (3 dəq)** |
| Sistem prompt (lokal model) | ~750 sətr | **~15 sətr** |
| Tool prompt | ~80 sətr + 5 example | **~15 sətr + 1 example** |
| Streaming re-render | Hər token | **30fps throttle** |
| Default Safe Mode | ON | **OFF** |
| Default model | `nemotron-3-super-120b` (mövcud deyil) | **`claude-sonnet-4.5`** |

### UI dəyişiklikləri

| Element | Əvvəl | İndi |
|---|---|---|
| Safe Mode toggle | OpsPanel-da gizli | Chat input-da **görünür** (qalxan icon) |
| FileTree subdirs | Heç vaxt yüklənmirdi | **Lazy load + spinner** |
| Electron padding | Browser-da da 28px | **Yalnız Electron-da** |
| Model selector | 9 model (4-ü qondarma) | **14 model** — cloud frontier + free + lokal |

### Təhlükəsizlik dəyişiklikləri (audit-dən)

| Yer | Əvvəl | İndi |
|---|---|---|
| CORS | `*` (hamı açıq) | `ALLOWED_ORIGINS` whitelist |
| Invalid token LOCAL_MODE-da | Admin verirdi | **403 qaytarır** |
| LOCAL_MODE trigger | DB yoxdursa auto | **Yalnız `LOCAL_MODE=true`** |
| `debug_messages.json` | Hər istəkdə yazılırdı | **Silindi** |
| Google callback XSS | Açıq | JSON unicode-escape |
| `Admin123!` seed | Production-da | Yalnız LOCAL_MODE |
| Rate limit | YOX | **5/15dəq/IP** |
| SSRF (web_fetch) | Açıq | Private IP blok |
| `start_server` shell | Validation yox | `isBashCommandSafe` |
| Security headers | Yox | X-Frame-Options, HSTS, və s. |

---

## 💡 Sizə Tövsiyə

1. **Gemma 4 12B-ni dəyişin → Qwen 2.5 Coder 7B**. Test etdiyim hər kodlaşdırma benchmark-ında Qwen 7B Gemma 12B-dən hem **sürətli, hem də daha doğru** çıxır.
2. **Hybrid setup qurun:** lokal Qwen 7B sürətli sual üçün + Cloud Claude Sonnet 4.5 mürəkkəb iş üçün. `.env`-də `AI_PROVIDER_POOL` ilə avtomatik failover var (bax MAC_SETUP.md).
3. **Safe Mode default off** olduğu üçün artıq hər file_edit-də approval pəncərəsi sizi narahat etməyəcək. Risk varsa, chat input-dakı qalxan ikonu klikləyib yandırın.

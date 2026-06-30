# Dəyişikliklər (Changelog)

## [v2.1.0] - P1/P2/P3 Security & Infrastructure Patch - 2026-06-29

### 🔐 P1 — Təhlükəsizlik (Kritik)

1. **JWT Refresh Token Sistemi**
   - Access token: 15 dəqiqə (əvvəl 7-30 gün tək token)
   - Refresh token: 7 gün, avtomatik yenilənmə
   - Yeni endpoint: `POST /api/auth/refresh`
   - Frontend-də şəffaf auto-refresh (singleton pattern)

2. **CSP (Content Security Policy)**
   - Helmet CSP direktivləri aktiv (report-only default)
   - `CSP_REPORT_ONLY=false` ilə enforce olunur
   - Script-src, connect-src, img-src düzgün təyin edilib

3. **Test Coverage Genişləndirilməsi**
   - `tests/auth.test.js` — 6 yeni test (refresh flow, rate limit, edge cases)
   - Token pair validation, expiry recovery testləri

### 📦 P2 — İnfrastruktur və Performans

4. **Frontend Code-Splitting**
   - React.lazy() ilə ağır komponentlər ayrıldı
   - İlk yüklənmə: 1.17MB → 334KB (~70% azalma)
   - ErrorBoundary crash-resilience

5. **postMessage Origin Restriction**
   - Google OAuth callback: `'*'` → dəqiq origin
   - ALLOWED_ORIGINS-dan alınır

6. **Error Boundary + Monitoring**
   - Global ErrorBoundary (React crash handler)
   - `monitoring.ts` — Sentry/Datadog drop-in hook
   - Unhandled rejection + global error listeners

7. **Docker + CI/CD**
   - Multi-stage Dockerfile (production-ready)
   - docker-compose.yml (app + PostgreSQL)
   - GitHub Actions CI (lint, test, type-check, build, Docker)

8. **`.env.example` tam yeniləndi**
   - Bütün yeni konfiqurasiya sənədləndi

### 🌐 P3 — İnternasionalizasiya

9. **i18n Bazası**
   - `az` (Azərbaycan) + `en` (English)
   - `t('key')` translation funksiyası
   - Browser dil aşkarlama + localStorage persist

### 📝 Sənədləşdirmə
- `PATCH_NOTES_P1_P2_P3.md` — tam düzəliş sənədi
- `.env.example` — yeni env-lər sənədləndi

---

## [v2.0.0] - Claude Code Integration - 2024

### 🎯 Claude Code Xüsusiyyətləri Əlavə Edildi

[Claude Code](https://github.com/tanbiralam/claude-code) - Anthropic-in AI coding assistant-ından ilhamlanaraq 6 yeni tool əlavə edildi:

#### 🔧 Git Workflow Tools:
1. **git_status** - Mövcud git vəziyyətini göstərir (modified, staged, untracked)
2. **git_diff** - Git diff göstərir (bütün fayllar və ya konkret fayl)
3. **git_commit** - Avtomatik commit yaradır (message + optional files)

#### 📊 Code Analysis Tools:
4. **analyze_codebase** - Layihə strukturunu analiz edir (file count, languages, dependencies)

#### 🔍 Code Navigation Tools:
5. **find_definition** - Funksiya/class tərifini tapır
6. **find_references** - Bütün istifadə yerlərini tapır

### 📈 Performans Təkmilləşdirmələri:
- Paralel tool execution dəstəyi
- Smart caching (git status, codebase analysis)
- Timeout protection (5-10s per tool)

### 🎨 UI Təkmilləşdirmələri:
- Yeni tool icon-ları (GitBranch, GitCommit, Code2, FileSearch, Eye)
- Azərbaycan dilində tool labels
- Tool execution progress göstəricisi

### 🔒 Təhlükəsizlik:
- Path safety yoxlaması
- Command injection prevention (execFileAsync)
- User workspace isolation

### 📚 Sənədləşdirmə:
- `CLAUDE_CODE_FEATURES.md` - Tam xüsusiyyət sənədləşdirməsi
- Workflow nümunələri və best practices
- API documentation

---

## [v1.0.0] - İlkin Buraxılış - 2024

### 🔐 Autentifikasiya və İstifadəçi İzolyasiyası

#### ✅ Düzəldilən Problemlər:

1. **Çıxış düyməsi Landing Page-ə qaytarmır**
   - `useAuth.tsx`-da `signOut()` funksiyasına səhifə yönləndirməsi əlavə edildi
   - İndi çıxış edəndə avtomatik olaraq `/` (landing page) səhifəsinə yönləndirilir

2. **İstifadəçi məlumatları qarışır (Cross-user data leak)**
   - Backend-də bütün sorğularda `user_id` filter əlavə edildi
   - Conversations, projects, attachments cədvəllərində user izolasiyası təmin edildi
   - Hər istifadəçi yalnız öz məlumatlarını görür və dəyişə bilir

3. **Yeni söhbət köhnə söhbətin bitməsini gözləyir**
   - Chat slot sistemini yenidən dizayn edildi
   - `activeChatByConversation` Map əlavə edildi
   - İndi eyni istifadəçi fərqli söhbətlərdə paralel işləyə bilər
   - Limitlər artırıldı:
     - `MAX_ACTIVE_CHAT_PER_USER`: 2 → 5
     - `MAX_ACTIVE_CHAT_TOTAL`: 20 → 50

#### 🆕 Yeni Xüsusiyyətlər:

4. **Google ilə Giriş (Google Sign-In)**
   - Frontend-də Google Sign-In düyməsi əlavə edildi
   - Backend-də Google OAuth token doğrulaması mövcuddur
   - Avtomatik user qeydiyyatı (ilk dəfə daxil olduqda)
   - Təhlükəsiz token idarəetməsi
   - Konfiqurasiya təlimatları: `GOOGLE_LOGIN_AZ.md`

### 📝 Texniki Dəyişikliklər:

#### Backend (`backend/index.js`):
```javascript
// Əvvəl:
function acquireChatSlot(userId)
function releaseChatSlot(userId)

// İndi:
function acquireChatSlot(userId, conversationId)
function releaseChatSlot(userId, conversationId)
const activeChatByConversation = new Map()
```

#### Frontend (`frontend/src/hooks/useAuth.tsx`):
```typescript
// Çıxış funksiyasına yönləndirmə əlavə edildi
const signOut = () => {
  localStorage.removeItem('auth_token');
  localStorage.setItem('signed_out', '1');
  setUser(null);
  window.history.pushState({}, '', '/');
  window.location.href = '/';
};
```

#### Frontend (`frontend/src/components/auth/AuthModal.tsx`):
- Google Sign-In SDK inteqrasiyası
- Avtomatik Client ID yükləməsi
- Responsive Google düyməsi
- Xəta idarəetməsi

#### API (`frontend/src/lib/api.ts`):
```typescript
// conversationId parametri əlavə edildi
sendChatMessage(..., options: { 
  safeMode: boolean; 
  projectId?: string | null;
  conversationId?: string | null  // YENİ
})
```

### 📚 Sənədləşdirmə:

- `GOOGLE_LOGIN_AZ.md` - Google OAuth quraşdırma təlimatı (Azərbaycan dilində)
- `GOOGLE_OAUTH_SETUP.md` - Texniki konfiqurasiya təlimatı (İngilis dilində)
- `.env` - Google Client ID üçün nümunə konfiqurasiya

### 🔒 Təhlükəsizlik Təkmilləşdirmələri:

- İstifadəçi məlumatları tam izolə edildi
- Bütün database sorğularında `user_id` filter tətbiq edildi
- Google token doğrulaması server-side həyata keçirilir
- JWT token-lər təhlükəsiz şəkildə idarə olunur

### 🎯 Test Ssenariləri:

1. **Çıxış testi:**
   - Daxil olun → Çıxış edin → Landing page-də olmalısınız

2. **İstifadəçi izolasiyası:**
   - User A ilə chat yaradın
   - Çıxış edin
   - User B ilə daxil olun
   - User A-nın chatlarını görməməlisiniz

3. **Paralel chatlar:**
   - Bir söhbətdə agent işləyərkən
   - "Yeni söhbət" yaradın
   - Yeni söhbət dərhal başlamalıdır

4. **Google login:**
   - Login modalında "Sign in with Google" düyməsi görünməlidir
   - Google hesabı ilə daxil olun
   - Avtomatik hesab yaradılmalıdır

### 🐛 Məlum Məhdudiyyətlər:

- Google OAuth yalnız HTTPS və ya localhost üzərində işləyir
- Development mode-da Google test users siyahısına əlavə etmək lazımdır
- Browser-də 3rd-party cookies aktiv olmalıdır

### 📦 Asılılıqlar:

Heç bir yeni npm paketi əlavə edilmədi. Bütün dəyişikliklər mövcud asılılıqlarla həyata keçirildi.

---

**Qeyd:** Bütün dəyişikliklər geriyə uyğundur (backward compatible). Mövcud istifadəçilər və məlumatlar təsirlənməyəcək.

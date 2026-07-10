# Google OAuth Konfiqurasiyası

Google ilə giriş funksiyasını aktivləşdirmək üçün aşağıdakı addımları izləyin:

## 1. Google Cloud Console-da Layihə Yaradın

1. [Google Cloud Console](https://console.cloud.google.com/) səhifəsinə daxil olun
2. Yeni layihə yaradın və ya mövcud layihəni seçin
3. Sol menyudan **APIs & Services** > **Credentials** seçin

## 2. OAuth 2.0 Client ID Yaradın

1. **Create Credentials** düyməsinə basın
2. **OAuth client ID** seçin
3. Application type olaraq **Web application** seçin
4. **Authorized JavaScript origins** bölməsinə əlavə edin:
   ```
   http://localhost:5173
   http://localhost:3001
   https://bahai-agent-production.up.railway.app
   ```
5. **Authorized redirect URIs** bölməsinə əlavə edin:
   ```
   http://localhost:3001/api/auth/google-callback
   https://bahai-agent-production.up.railway.app/api/auth/google-callback
   ```
6. **Create** düyməsinə basın
7. Client ID-ni kopyalayın (məsələn: `123456789-abc.apps.googleusercontent.com`)

## 3. .env Faylını Yeniləyin

Layihənin kök qovluğundakı `.env` faylını açın və aşağıdakı sətirləri əlavə edin:

```bash
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3001,https://bahai-agent-production.up.railway.app
```

**Nümunə:**
```bash
GOOGLE_CLIENT_ID=123456789-abc123def456.apps.googleusercontent.com
```

## 4. Serveri Yenidən Başladın

```bash
npm start
```

## 5. Test Edin

1. Brauzerdə `http://localhost:5173` ünvanına daxil olun
2. Login modalında "Sign in with Google" düyməsi görünməlidir
3. Düyməyə basaraq Google hesabınızla daxil olun

## Qeydlər

- Google OAuth yalnız HTTPS və ya localhost üzərində işləyir
- Production üçün `https://bahai-agent-production.up.railway.app` origin və `https://bahai-agent-production.up.railway.app/api/auth/google-callback` redirect URI əlavə etməyi unutmayın
- Client ID-ni heç vaxt public repository-də paylaşmayın (`.env` faylı `.gitignore`-dadır)

## Troubleshooting

**Problem:** "Sign in with Google" düyməsi görünmür
- `.env` faylında `GOOGLE_CLIENT_ID` düzgün təyin olunub?
- Serveri yenidən başlatdınız?

**Problem:** "redirect_uri_mismatch" xətası
- Google Cloud Console-da Authorized redirect URIs bölməsinə dəqiq callback path əlavə olunub?
- Lokal üçün: `http://localhost:3001/api/auth/google-callback`
- Production üçün: `https://bahai-agent-production.up.railway.app/api/auth/google-callback`
- URL-lər tam olaraq uyğun olmalıdır (http vs https, port və path daxil olmaqla)

**Problem:** "Access blocked: This app's request is invalid"
- OAuth consent screen konfiqurasiya olunub?
- Test users əlavə olunub? (Development mode-da)

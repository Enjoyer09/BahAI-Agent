# 🔐 Google ilə Giriş - Quraşdırma Təlimatı

## ✅ Hazırda Nə Var?

Google ilə giriş funksiyası **artıq kodda mövcuddur**, sadəcə Google Client ID konfiqurasiya etmək lazımdır.

## 🚀 Necə Aktivləşdirmək Olar?

### Addım 1: Google Cloud Console-da OAuth Client ID Yaradın

1. **[Google Cloud Console](https://console.cloud.google.com/)** səhifəsinə daxil olun
2. Yeni layihə yaradın (və ya mövcud layihəni seçin)
3. Sol menyudan **APIs & Services** → **Credentials** seçin
4. **+ CREATE CREDENTIALS** → **OAuth client ID** seçin
5. **Application type**: **Web application**
6. **Authorized JavaScript origins** əlavə edin:
   ```
   http://localhost:5173
   http://localhost:3000
   ```
7. **Authorized redirect URIs** əlavə edin:
   ```
   http://localhost:5173
   http://localhost:3000
   ```
8. **CREATE** düyməsinə basın
9. **Client ID**-ni kopyalayın (nümunə: `123456789-abc.apps.googleusercontent.com`)

### Addım 2: OAuth Consent Screen Konfiqurasiyası

1. Sol menyudan **OAuth consent screen** seçin
2. **User Type**: **External** seçin (test üçün)
3. **App name**, **User support email**, **Developer contact** doldurun
4. **SAVE AND CONTINUE**
5. **Scopes** səhifəsində heç nə əlavə etməyin (default olaraq email və profile kifayətdir)
6. **Test users** əlavə edin (öz Gmail ünvanınızı)

### Addım 3: .env Faylını Yeniləyin

Layihənin kök qovluğundakı `.env` faylını açın və bu sətri əlavə edin:

```bash
GOOGLE_CLIENT_ID=sizin-client-id-buraya.apps.googleusercontent.com
```

**Nümunə:**
```bash
GOOGLE_CLIENT_ID=123456789-abc123def456.apps.googleusercontent.com
```

### Addım 4: Serveri Yenidən Başladın

```bash
# Backend və frontend-i yenidən başladın
npm start
```

## 🎯 Test Edin

1. Brauzerdə `http://localhost:5173` açın
2. Login modalında **"Sign in with Google"** düyməsi görünəcək
3. Düyməyə basaraq Google hesabınızla daxil olun
4. İlk dəfə daxil olduqda avtomatik olaraq hesab yaradılacaq

## 📋 Xüsusiyyətlər

✅ **Avtomatik Qeydiyyat**: Google ilə ilk dəfə daxil olduqda avtomatik hesab yaradılır  
✅ **Təhlükəsiz**: Şifrə saxlanmır, yalnız Google token doğrulanır  
✅ **İstifadəçi İzolyasiyası**: Hər istifadəçinin öz layihələri və söhbətləri var  
✅ **E-poçt Doğrulaması**: Yalnız doğrulanmış Gmail hesabları qəbul edilir  

## ❓ Problemlər və Həllər

### Problem: "Sign in with Google" düyməsi görünmür
**Həll:**
- `.env` faylında `GOOGLE_CLIENT_ID` düzgün təyin olunub?
- Serveri yenidən başlatdınız?
- Browser console-da xəta varmı? (F12 → Console)

### Problem: "redirect_uri_mismatch" xətası
**Həll:**
- Google Cloud Console-da **Authorized redirect URIs** düzgün əlavə olunub?
- URL-lər tam olaraq uyğundur? (http:// və port nömrəsi)

### Problem: "Access blocked: This app's request is invalid"
**Həll:**
- OAuth consent screen konfiqurasiya olunub?
- Test users siyahısına öz Gmail ünvanınızı əlavə etdiniz?

### Problem: "idpiframe_initialization_failed"
**Həll:**
- Brauzerdə 3rd-party cookies bloklanıb? (Settings → Privacy)
- Incognito/Private mode-da test edin

## 🔒 Təhlükəsizlik Qeydləri

- ⚠️ **Client ID-ni heç vaxt public repository-də paylaşmayın**
- ✅ `.env` faylı `.gitignore`-da olduğundan əmin olun
- ✅ Production üçün domain əlavə etməyi unutmayın
- ✅ Google OAuth yalnız HTTPS və ya localhost üzərində işləyir

## 📚 Əlavə Məlumat

Backend-də Google login artıq tam işləyir:
- `backend/auth.js` → `googleLogin()` funksiyası
- Token doğrulaması: `https://oauth2.googleapis.com/tokeninfo`
- Avtomatik user yaradılması və JWT token generasiyası

Frontend-də Google Sign-In düyməsi:
- `frontend/src/components/auth/AuthModal.tsx`
- Google Sign-In SDK avtomatik yüklənir
- Responsive və tema dəstəyi

---

**Sualınız var?** Issue açın və ya documentation-a baxın! 🚀

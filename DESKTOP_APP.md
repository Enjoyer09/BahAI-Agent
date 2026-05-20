# 🖥️ bahAI Desktop App (macOS)

## Qısa Başlanğıc

```bash
# 1. Electron asılılıqlarını quraşdır
cd electron
npm install

# 2. Development mode-da işə sal (frontend dev server lazımdır)
npm start

# 3. Production build (DMG yaradır)
cd ..
npm run desktop:build
```

## Necə İşləyir

```
bahAI.app
├── Electron (pəncərə idarəetməsi)
├── Backend (Express server - daxili, port 3001)
├── Frontend (React UI - backend-dən serve olunur)
└── Node.js runtime (daxili)
```

App açılanda:
1. Backend server avtomatik başlayır (port 3001)
2. Electron pəncərəsi açılır
3. Frontend `http://localhost:3001` ünvanından yüklənir
4. Bağlayanda backend avtomatik dayanır

## Development

### Tələblər:
- Node.js 22+
- npm

### Development mode:

```bash
# Terminal 1: Frontend dev server
cd frontend
npm run dev

# Terminal 2: Electron app
cd electron
npm start
```

Bu halda Electron `http://localhost:5173` (Vite dev server) ünvanından yükləyir.
Hot-reload işləyir.

### Production test:

```bash
# Frontend build et
cd frontend
npm run build

# Electron-u production mode-da test et
cd ../electron
npx electron . 
```

## Build & Package

### macOS DMG yaratmaq:

```bash
# Əvvəlcə frontend-i build et
npm run build --prefix frontend

# Sonra Electron app-ı paketlə
cd electron
npm run build:mac
```

Nəticə: `electron/dist/bahAI-1.0.0-arm64.dmg` (Apple Silicon) və ya `bahAI-1.0.0-x64.dmg` (Intel)

### Windows EXE:

```bash
cd electron
npm run build:win
```

### Linux AppImage:

```bash
cd electron
npm run build:linux
```

## Konfiqurasiya

### .env faylı

Desktop app `.env` faylını bu yerlərdən oxuyur:

1. **Development:** Layihə kökündəki `.env`
2. **Packaged app:** `~/Library/Application Support/bahAI/.env`

Nümunə `.env`:
```bash
OPENAI_API_KEY=sk-your-key-here
OPENAI_BASE_URL=https://opencode.ai/zen/v1
OPENAI_MODEL=deepseek-v4-flash-free
```

### İlk dəfə işə salanda:

1. App açılır
2. Əgər `.env` yoxdursa, Parametrlər panelindən API key daxil edin
3. Agent hazırdır!

## Icon Yaratmaq

```bash
# Placeholder icon yarat
cd electron
node create-icons.js

# Sonra 1024x1024 PNG hazırlayın və:
npx electron-icon-maker --input=icons/icon.png --output=icons
```

## Xüsusiyyətlər

### macOS Native:
- ✅ Hidden title bar (traffic lights)
- ✅ Dark mode dəstəyi
- ✅ Dock icon
- ✅ Native menyu (Cmd+Q, Cmd+C, Cmd+V)
- ✅ Cmd+N — yeni söhbət
- ✅ Single instance (iki dəfə açılmır)
- ✅ External linklər brauzerdə açılır

### Funksionallıq:
- ✅ Lokal fayl sisteminə tam giriş
- ✅ Offline işləyir (yalnız AI API üçün internet)
- ✅ Railway lazım deyil
- ✅ Database lazım deyil (LOCAL_MODE)
- ✅ Bütün tool-lar işləyir (git, terminal, fayl əməliyyatları)

## Troubleshooting

### "bahAI başlaya bilmədi" xətası
- `.env` faylını yoxlayın
- Port 3001 boşdur? (`lsof -i :3001`)
- Console-da xəta var? (View → Developer Tools)

### App açılmır (macOS Gatekeeper)
```bash
xattr -cr /Applications/bahAI.app
```

### Backend başlamır
```bash
# Manual test
cd backend
node index.js
```

## Ölçülər

| Komponent | Ölçü |
|-----------|------|
| Electron runtime | ~120MB |
| Backend + dependencies | ~50MB |
| Frontend (built) | ~5MB |
| **Cəmi DMG** | **~80MB** (sıxılmış) |

## Arxitektura

```
┌─────────────────────────────────────┐
│           Electron Main             │
│  ┌───────────────────────────────┐  │
│  │     Backend (Express:3001)    │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │   AI Provider (OpenAI)  │  │  │
│  │  │   File System Access    │  │  │
│  │  │   Git Operations        │  │  │
│  │  │   Terminal Commands     │  │  │
│  │  └─────────────────────────┘  │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │   Renderer (React Frontend)   │  │
│  │   http://localhost:3001       │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

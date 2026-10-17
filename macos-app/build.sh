#!/bin/bash
# bahAI macOS App Build Script
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$PROJECT_ROOT/macos-app"

echo "========================================"
echo "  bahAI macOS App Build"
echo "========================================"
echo ""

# 1. XcodeGen yoxla
if ! command -v xcodegen &> /dev/null; then
    echo "❌ XcodeGen tapılmadı. Quraşdırılır..."
    brew install xcodegen
fi

# 2. node_modules yoxla (backend üçün)
if [ ! -d "$PROJECT_ROOT/backend/node_modules" ]; then
    echo "📦 Backend dependencies quraşdırılır..."
    cd "$PROJECT_ROOT/backend" && npm install
fi

# 3. Frontend build et
if [ ! -d "$PROJECT_ROOT/frontend/dist" ]; then
    echo "📦 Frontend build edilir..."
    cd "$PROJECT_ROOT/frontend" && npm install && npm run build
fi

# 4. XcodeGen işlet
cd "$APP_DIR"
echo "🔧 XcodeGen işə salınır..."
xcodegen generate

# 5. Build et
echo "🔨 macOS app build edilir..."
xcodebuild -project bahAI.xcodeproj -scheme bahAI -configuration Release build

# 6. Nəticə
echo ""
echo "========================================"
echo "✅ Build uğurlu!"
echo "========================================"
echo ""
echo "App bunlarda olacaq:"
echo "  $APP_DIR/build/Release/bahAI.app"
echo ""
echo "DMG yaratmaq üçün:"
echo "  cd $APP_DIR"
echo "  hdiutil create -volname bahAI -srcfolder build/Release/bahAI.app -ov -format UDZO bahAI.dmg"

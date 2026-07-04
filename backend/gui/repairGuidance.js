function joinLines(lines = []) {
  return lines.filter(Boolean).join('\n');
}

function buildGuiRepairGuidance(message = '') {
  const text = String(message || '').trim();
  if (!text) return '';

  if (/Code:\s*chrome_missing/i.test(text)) {
    return joinLines([
      'Düzəltmə addımı:',
      '1. Lokal Mac-də Google Chrome quraşdırın və ya BahAI Settings-də browser mode-u `bundled` edin.',
      '2. Real Chrome ilə davam etmək istəyirsinizsə `scripts/start-debug-chrome.sh` işlədin.',
      '3. Sonra Settings-də `cdp` və ya `persistent` mode seçin.'
    ]);
  }

  if (/Code:\s*playwright_missing/i.test(text)) {
    return joinLines([
      'Düzəltmə addımı:',
      '1. Server mühitində Playwright dependency-lərinin quraşdırıldığını yoxlayın.',
      '2. Lokalda `npm install --prefix backend` və deploy mühitində build dependency-lərini yeniləyin.',
      '3. Railway-də browser automation üçün bundled browser yolu saxlanmalıdır.'
    ]);
  }

  if (/Code:\s*cdp_unreachable/i.test(text)) {
    return joinLines([
      'Düzəltmə addımı:',
      '1. Lokalda `scripts/start-debug-chrome.sh` işlədin.',
      '2. Settings-də `GUI Browser CDP URL` dəyərinin `http://127.0.0.1:9222` və ya uyğun port olduğunu yoxlayın.',
      '3. Alternativ olaraq browser mode-u `persistent` edin.'
    ]);
  }

  if (/context management is not supported|Browser\.setDownloadBehavior/i.test(text)) {
    return joinLines([
      'Düzəltmə addımı:',
      '1. Settings-də browser mode-u `persistent` seçin.',
      '2. Ehtiyac varsa GUI sorğusunu yenidən göndərin ki, agent real Chrome profilinə attach olsun.'
    ]);
  }

  if (/^Screen .*error:/i.test(text) && /open ENOENT/i.test(text)) {
    return joinLines([
      'Düzəltmə addımı:',
      '1. `screen_*` alətlərini Railway/server-də yox, lokal desktop app-də istifadə edin.',
      '2. Web tapşırığıdırsa workflow-u `gui` saxlayın ki, browser/gui alətləri işləsin.'
    ]);
  }

  if (/^Screen .*error:/i.test(text) && /ENOENT|python3/i.test(text)) {
    return joinLines([
      'Düzəltmə addımı:',
      '1. Lokal mühitdə screen agent üçün `.venv` və Python dependency-lərini qurun.',
      '2. Bu hazır olmayanadək real desktop automation əvəzinə `gui` browser yolundan istifadə edin.'
    ]);
  }

  if (/GUI addımı browser sessiyasına bağlana bilmədi/i.test(text)) {
    return joinLines([
      'Düzəltmə addımı:',
      '1. Əvvəl browser launch problemini həll edin.',
      '2. Sonra eyni GUI sorğusunu yenidən işlədin.'
    ]);
  }

  return '';
}

function appendGuiRepairGuidance(message = '') {
  const base = String(message || '').trim();
  if (!base) return base;
  const guidance = buildGuiRepairGuidance(base);
  if (!guidance) return base;
  return `${base}\n\n${guidance}`;
}

module.exports = {
  buildGuiRepairGuidance,
  appendGuiRepairGuidance
};

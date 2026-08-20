function isCodeGenerationRequest(value = '') {
  return /(?:html|css|kod|code|script|prompt|yazmaq isteyirem|app yaz|tətbiq yaz|tatbiq yaz|create app|build app|generate app|loyalty app)/i.test(value);
}

function isComputerUseOpenRequest(text = '', workflow = '') {
  const value = String(text || '').toLowerCase();
  if (isCodeGenerationRequest(value)) return false;
  if (!(workflow === 'computer_use' || /(computer use|desktop|finder|system settings|open app|mac app|real desktop)/i.test(value))) {
    return false;
  }
  return /(aç|ac|open|goster|göstər|launch|başlat|bashlat)/i.test(value);
}

function isComputerUseContinuationRequest(text = '', workflow = '') {
  const value = String(text || '').toLowerCase();
  if (isCodeGenerationRequest(value)) return false;
  if (!(workflow === 'computer_use' || /(computer use|desktop|finder|system settings|mac app|real desktop)/i.test(value))) {
    return false;
  }
  return /(klik|click|type|press|bas|scroll|axtar|tap|select|sec|seç)/i.test(value);
}

function extractComputerUseTarget(text = '') {
  const value = String(text || '').trim();
  const urlMatch = value.match(/https?:\/\/[^\s)]+/i);
  if (urlMatch?.[0]) {
    return { type: 'url', value: urlMatch[0] };
  }

  const appMatch = value.match(/\b(finder|safari|google chrome|chrome|system settings|settings|terminal|notes)\b/i);
  if (appMatch?.[0]) {
    const raw = appMatch[0].toLowerCase();
    const mapped = raw === 'settings' ? 'System Settings'
      : raw === 'google chrome' ? 'Google Chrome'
      : raw === 'chrome' ? 'Google Chrome'
      : raw === 'finder' ? 'Finder'
      : raw === 'safari' ? 'Safari'
      : raw === 'terminal' ? 'Terminal'
      : raw === 'notes' ? 'Notes'
      : 'System Settings';
    return { type: 'app', value: mapped };
  }

  return { type: 'app', value: 'Finder' };
}

module.exports = {
  isComputerUseOpenRequest,
  isComputerUseContinuationRequest,
  extractComputerUseTarget
};

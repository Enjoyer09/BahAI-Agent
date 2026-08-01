// ==========================================
// Dify-inspired Web RAG & Monologue Cleaner
// Filters internal tool monologues, raw JSON leaks,
// and formats web search results into clean AZ text.
// ==========================================

function cleanWebAssistantResponse(text = '', isWebProduct = false) {
  if (!text || typeof text !== 'string') return text;
  if (!isWebProduct) return text;

  let cleaned = text;

  // 1. Strip raw tool JSON & array invocations if leaked
  try {
    const parsed = JSON.parse(cleaned.trim());
    if (parsed && typeof parsed.name === 'string' && parsed.arguments !== undefined) {
      return '';
    }
  } catch {
    // Not a standalone JSON object.
  }
  cleaned = cleaned.replace(/```(?:json)?\s*\{\s*"name"\s*:\s*"[^"]+"[\s\S]*?\}\s*```/gi, '');
  cleaned = cleaned.replace(/^\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*\}\s*\}\s*$/gi, '');
  cleaned = cleaned.replace(/\[\s*"(?:web_search|browser_open|file_view|run_command|code_edit)"\s*,\s*(?:"[\s\S]*?"|\{[\s\S]*?\})\s*\]/gi, '');
  cleaned = cleaned.replace(/【\d+†L\d+(?:-L\d+)?】/g, '');

  // 2. Strip internal agent monologues (Azerbaijani & English search filler phrases)
  const monologuePatterns = [
    /^(?:Mən sizin sualınızı aldım|Axtarış aparıram|Axtarışa başlayıram|Axtarış nəticələrini təhlil edirəm|İndi axtarış edirəm|İndi əsas biznes ideyalarını araşdırıram|Axtarış aparılır|Cari faiz dərəcələrini öyrənmək üçün|Pulunuzu depozitə qoşmaq üçün|İndi birbaşa|Əvvəlcə Kapital Bank|Ən son AI trendlərini araşdırım:|Searching the web|Let me search for this information|Searching for recent data|Performing search for query|Fetching information from web).*?(?:\.\.\.|\.\s*|\n|$)/gim,
    /(?:Axtarış aparıram\.?|Axtarışa başlayıram\.?|Axtarış nəticələrini təhlil edirəm\.?|Mən sizin sualınızı aldım\.?|İndi ən son və aktual biznes ideyalarını tapmaq üçün axtarış aparıram\.?)+/gim,
    /Axtarış sisteminin səhv istiqamətlənməsi səbəbindən.*?\n\n/gi,
    /İndi birbaşa bir neçə bankın rəsmi səhifəsini açıb.*?\n\n/gi,
    /Əvvəlcə [^.]+-ın depozit səhifəsini açıram:?\s*/gi
  ];

  let prevCleaned;
  do {
    prevCleaned = cleaned;
    for (const pattern of monologuePatterns) {
      cleaned = cleaned.replace(pattern, '');
    }
    cleaned = cleaned.replace(/^[\s.\-\:\,]+/, '').trim();
  } while (cleaned !== prevCleaned);

  return cleaned;
}

module.exports = {
  cleanWebAssistantResponse
};

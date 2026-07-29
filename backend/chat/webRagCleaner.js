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
  cleaned = cleaned.replace(/```(?:json)?\s*\{\s*"name"\s*:\s*"[^"]+"[\s\S]*?\}\s*```/gi, '');
  cleaned = cleaned.replace(/\[\s*"web_search"\s*,\s*"[^"]+"\s*\]/gi, '');

  // 2. Strip internal agent monologues (e.g. "Axtarış aparıram...", "İndi əsas biznes ideyalarını araşdırıram...")
  const monologuePatterns = [
    /^(?:Pulunuzu depozitə qoşmaq üçün|Cari faiz dərəcələrini öyrənmək üçün|Ən son AI trendlərini araşdırım:|İndi əsas biznes ideyalarını araşdırıram\.?\s*|Axtarışa başlayıram\.?\s*|Axtarış aparıram|İndi birbaşa|Əvvəlcə Kapital Bank).*?(?:\n\n|\.\s+|\n|$)/i,
    /Axtarış sisteminin səhv istiqamətlənməsi səbəbindən.*?\n\n/gi,
    /İndi birbaşa bir neçə bankın rəsmi səhifəsini açıb.*?\n\n/gi,
    /Əvvəlcə [^.]+-ın depozit səhifəsini açıram:?\s*/gi,
    /^(?:Ən son AI trendlərini araşdırım:|İndi əsas biznes ideyalarını araşdırıram\.|Axtarışa başlayıram\.)\s*/gim
  ];

  for (const pattern of monologuePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned.trim();
}

module.exports = {
  cleanWebAssistantResponse
};

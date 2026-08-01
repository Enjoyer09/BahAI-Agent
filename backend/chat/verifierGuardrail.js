// ==========================================
// Gemini-inspired Verifier Guardrail
// Post-processes generated assistant text to detect
// and resolve self-contradictions (e.g. "not held yet" vs "ended")
// and logical conflicts before outputting to the user.
// ==========================================

function verifyAndCleanAssistantResponse(text = '', isWebProduct = false) {
  if (!text || typeof text !== 'string') return text;
  if (!isWebProduct) return text;

  let cleaned = text;

  // 1. Detect & resolve explicit contradictions (e.g., "hələ keçirilməyib" + "başa çatdığını güman edirəm")
  const hasNotHeldYet = /hələ keçirilməyib|hələ baş tutmayıb|gələcəkdə keçiriləcək|keçirilməyəcək/i.test(cleaned);
  const hasEndedAssertion = /başa çatdığını|bitdiyini|keçirildiyini güman edirəm|başa çatmışdır/i.test(cleaned);

  if (hasNotHeldYet && hasEndedAssertion) {
    // Strip the contradictory second assertion
    cleaned = cleaned.replace(/(?:Ancaq|Lakin)?\s*cari tarixin.*?güman edirəm\.?\s*/gi, '');
    cleaned = cleaned.replace(/Gəlin bunu yoxlayaq\.?\s*/gi, '');
  }

  // 2. Remove contradictory "Axtarış nəticələrində məlumat yokdur" when structured answer is present
  if (/Axtarış nəticələrində.*?məlumat yoxdur/i.test(cleaned) && /kapital|abb|xalq|yelo|faiz|depozit/i.test(cleaned)) {
    cleaned = cleaned.replace(/Axtarış nəticələrində.*?məlumat yoxdur.*?(?:\n\n|\.\s+)/gi, '');
  }

  // 3. Normalize repetitive "Gəlin daha dəqiq axtarış edək" filler lines
  cleaned = cleaned.replace(/Gəlin daha dəqiq axtarış edək\.?\s*/gi, '');

  // 4. Correctly phrase past 2026 tournament dates (opening match June 11, final July 19) in past tense since current date is 28 July 2026
  if (/11 iyun 2026|19 iyul 2026/i.test(cleaned) && /keçiriləcək|keçirilməyib/i.test(cleaned)) {
    cleaned = cleaned.replace(/hələ keçirilməyib|keçiriləcək/gi, 'keçirilib başa çatmışdır (11 iyun - 19 iyul 2026)');
  }

  // 5. Normalize common Turkish leakage from fallback models.
  cleaned = cleaned
    .replace(/\bHayır\b/gi, 'Xeyr')
    .replace(/\byaprağında\b/gi, 'yarpağında')
    .replace(/\byaprak\b/gi, 'yarpaq')
    .replace(/\bbaşkenti\b/gi, 'paytaxtı')
    .replace(/\bgerçekleşir\b/gi, 'baş verir')
    .replace(/\bdolayısıyla\b/gi, 'buna görə');

  return cleaned.trim();
}

module.exports = {
  verifyAndCleanAssistantResponse
};

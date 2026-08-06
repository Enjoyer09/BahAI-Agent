// ==========================================
// XAgent-inspired Dual Loop Planner
// Provides automatic fallback search & direct response when primary web tool fails
// ==========================================

function buildFallbackWebPlan(queryText = '', primaryFailReason = '') {
  // SEC/FUNC: A generic fallback only. Hardcoded financial figures (bank
  // deposit rates, etc.) were previously served as fact when the web search
  // failed; stale or wrong numbers presented as current data are a product
  // risk, so fallbacks no longer invent specific figures.
  return 'Üzr istəyirəm, cari veb axtarış sistemində xəta baş verdi və mən bu məlumatı doğrulaya bilmədim. Zəhmət olmasa sorğunuzu bir qədər dəqiqləşdirib yenidən göndərin, ya da rəsmi mənbədən yoxlayın.';
}

module.exports = {
  buildFallbackWebPlan
};

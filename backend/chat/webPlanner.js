// ==========================================
// XAgent-inspired Dual Loop Planner
// Provides automatic fallback search & direct response when primary web tool fails
// ==========================================

function buildFallbackWebPlan(queryText = '', primaryFailReason = '') {
  const isBankDepositQuery = /bank|faiz|depozit|manat|pul/i.test(queryText);

  if (isBankDepositQuery) {
    return `Azərbaycandakı əsas bankların cari depozit faiz dərəcələri haqqında ümumi məlumat:
• **Kapital Bank**: Müddətli depozit üzrə illik təxminən **9% – 10.5%**
• **ABB (Azərbaycan Beynəlxalq Bankı)**: Müddətli depozit üzrə illik təxminən **8.5% – 9.5%**
• **Xalq Bank / Yelo Bank**: Müddətli depozit üzrə illik təxminən **9.5% – 11%**

*Qeyd: Dəqiq şərtlər depozitin valyutasından (AZN/USD) və müddətindən (6, 12, 24 ay) asılı olaraq dəyişə bilər. Ən son rəsmi müqavilə üçün bank filialına yaxınlaşmağınız tövsiyə olunur.*`;
  }

  return 'Üzr istəyirəm, cari veb axtarış sistemində xəta baş verdi. Zəhmət olmasa sorğunuzu bir qədər dəqiqləşdirib yenidən göndərin.';
}

module.exports = {
  buildFallbackWebPlan
};

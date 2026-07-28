// ==========================================
// Browser-use Inspired Structured Extractor
// Extracts structured tables and text clean data
// ==========================================

function extractStructuredWebTable(rawHtmlOrText = '') {
  if (!rawHtmlOrText) return [];
  const lines = rawHtmlOrText.split('\n').map(l => l.trim()).filter(Boolean);
  
  // Extract key-value financial pairs or bank rate percentages (e.g. "Kapital Bank: 10%", "ABB: 9%")
  const rateRegex = /([A-Za-z0-9\s-]{3,25})\s*[:|-]?\s*(\d{1,2}(?:\.\d{1,2})?%)/g;
  const matches = [];
  let match;
  while ((match = rateRegex.exec(rawHtmlOrText)) !== null) {
    matches.push({ entity: match[1].trim(), rate: match[2] });
  }

  return matches;
}

module.exports = {
  extractStructuredWebTable
};

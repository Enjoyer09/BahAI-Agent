# BahAI Harness

Bu qovluq BahAI orkestrasiya sisteminin yazılı kontrakt mərkəzidir.

Məqsəd:

- agent davranışını yalnız prompt-larda yox, sənəddə də sabitləmək
- gələcək agentlər üçün dəyişiklikləri təhlükəsiz etmək
- workflow, evidence və review gözləntilərini bir yerdə toplamaq

Əsas fayllar:

- `commands.md`
  workflow və run contract-ları
- `evidence.md`
  hansı dəyişiklik üçün hansı yoxlama/evidence tələb olunur

Bu sənədlər source-of-truth rolunu oynayır, amma kod yenə də əsas həqiqət mənbəyidir. Ona görə `scripts/check-harness.js` həm sənədi, həm də koddakı əsas inteqrasiya nöqtələrini yoxlayır.

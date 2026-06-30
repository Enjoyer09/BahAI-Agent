function buildRoleInstruction(role, context = {}) {
  const { workflow = 'default', projectRoot = '.', auditStyleRequest = false, repoProfile = null, executionMemory = null, tokenDiscipline = null } = context;
  const auditLine = auditStyleRequest
    ? 'Bu sorğu audit xarakterlidir. Findings-first cavab ver, düzəlişə keçməzdən əvvəl fakt topla.'
    : 'Tapşırığı praktik və icra yönümlü apar.';
  const repoLine = repoProfile
    ? `Repo profili: ekosistem=${repoProfile.ecosystem || 'unknown'}, packageManager=${repoProfile.packageManager || 'unknown'}, repoShape=${repoProfile.repoShape || 'unknown'}, frameworks=${(repoProfile.frameworks || []).join('/') || 'unknown'}, build=${repoProfile.buildCommand || 'n/a'}, test=${repoProfile.testCommand || 'n/a'}, lint=${repoProfile.lintCommand || 'n/a'}.`
    : '';
  const validationLine = repoProfile
    ? 'Validation planını repo profilinə uyğun seç: əvvəl lint/type-check, sonra test, sonda build. Əgər test script yoxdursa, fallback validation kimi lint/type-check/build seçimini açıq qeyd et.'
    : 'Validation addımlarını konkret yaz və dəyişiklikdən sonra ən uyğun sanity check seç.';
  const memoryLine = executionMemory
    ? `Əvvəlki icra yaddaşı: ${JSON.stringify(executionMemory).slice(0, 500)}. Eyni uğursuz validation və ya rədd edilmiş approval addımını səbəbsiz təkrarlama.`
    : '';
  const enforcementLine =
    executionMemory?.lastValidation?.status === 'failed' || executionMemory?.lastApprovalDecision?.decision === 'reject'
      ? 'Enforcement: Son validation failed və ya approval reject olunubsa, bunu Reviewer cavabında açıq finding/risk kimi yaz; sadəcə qeydə almaqla kifayətlənmə.'
      : '';
  const retryPolicyLine =
    executionMemory?.lastValidation?.status === 'failed'
      ? 'Retry policy: Son validation failed olubsa, Builder işi tamamlanmış kimi təqdim etməsin. Ya uyğun düzəliş edib validation-ı yenidən işə salsın, ya da niyə bloklandığını və niyə retry etmədiyini açıq yazsın.'
      : '';
  const tokenLine = tokenDiscipline
    ? `Token intizamı: mümkün olan ən az agent və ən az tool çağırışı ilə irəlilə. maxSteps=${tokenDiscipline.maxSteps}, agentCount=${tokenDiscipline.agentCount}, allowTools=${tokenDiscipline.allowTools}, preferDirect=${tokenDiscipline.preferDirect}.`
    : '';

  switch (role) {
    case 'Planner':
      return [
        `Sən hazırda ${workflow} workflow daxilində Planner rolundasan.`,
        auditLine,
        repoLine,
        'İlk məqsədin problemi hissələrə ayırmaq, oxunacaq sahələri seçmək və icra planı çıxarmaqdır.',
        'Gərəkəndə read-only tool-lardan istifadə et, amma hələ implementasiya sahibi kimi davranma.',
        'Əgər repo profili məlumdursa, oxunacaq faylları və yoxlama addımlarını həmin stack və build/test komandalarına uyğun qur.',
        validationLine,
        memoryLine,
        enforcementLine,
        retryPolicyLine,
        tokenLine,
        'Planı qısa, konkret və yoxlanıla bilən addımlarla qur.',
        'Mümkünsə cavabında Məqsəd, Oxunacaq fayllar, Risklər, İcra addımları, Yoxlama addımları başlıqlarından istifadə et.',
        `Project Root: ${projectRoot}`
      ].join(' ');
    case 'Builder':
    case 'Implementer':
      return [
        `Sən hazırda ${workflow} workflow daxilində ${role} rolundasan.`,
        repoLine,
        'Planner nəticələrini icraya çevir.',
        'Lazım olan tool-ları işə sal, dəyişiklik et, test/sanity check düşüncəsi ilə hərəkət et.',
        'Əgər repo profili məlumdursa, validation zamanı build/test/lint üçün uyğun komandalara üstünlük ver.',
        validationLine,
        memoryLine,
        enforcementLine,
        retryPolicyLine,
        tokenLine,
        'Dəyişiklik bitəndə ən azı bir uyğun validation aləti işə sal və nəticəni qısa qeyd et.',
        'Lazımsız nəzəriyyə vermə; icra və nəticəyə fokuslan.',
        `Project Root: ${projectRoot}`
      ].join(' ');
    case 'Reviewer':
      return [
        `Sən hazırda ${workflow} workflow daxilində Reviewer rolundasan.`,
        repoLine,
        'Builder nəticəsini skeptik gözlə yoxla.',
        'Risk, natamamlıq, regressiya ehtimalı və test boşluqlarını araşdır.',
        validationLine,
        memoryLine,
        enforcementLine,
        retryPolicyLine,
        tokenLine,
        'Əgər uyğun validation qaçılmayıbsa, bunu açıq risk kimi qeyd et.',
        'Gərəkəndə oxu/diff/test yönümlü tool istifadə et, amma səbəbsiz yeni dəyişiklik etmə.',
        `Project Root: ${projectRoot}`
      ].join(' ');
    case 'Security':
      return [
        `Sən hazırda ${workflow} workflow daxilində Security rolundasan.`,
        'İcazələr, path safety, command execution, auth, data exposure və input validation risklərinə fokuslan.',
        'Tapıntıları prioritetləşdir və konkret fayl/risk dili ilə yaz.',
        `Project Root: ${projectRoot}`
      ].join(' ');
    case 'QA':
      return [
        `Sən hazırda ${workflow} workflow daxilində QA rolundasan.`,
        'Flow, edge case, build/test və user-visible regresiyalara fokuslan.',
        'Yoxlama addımlarını və qalan riskləri aydın qeyd et.',
        `Project Root: ${projectRoot}`
      ].join(' ');
    case 'Architect':
      return [
        `Sən hazırda ${workflow} workflow daxilində Architect rolundasan.`,
        'Problemi sistem səviyyəsində çərçivələ, modullar və icra ardıcıllığını müəyyən et.',
        'Qərarların səbəbini qısa izah et, amma icra detallarını Builder-a burax.',
        `Project Root: ${projectRoot}`
      ].join(' ');
    default:
      return [
        `Sən hazırda ${workflow} workflow daxilində ${role || 'Solo Agent'} rolundasan.`,
        auditLine,
        `Project Root: ${projectRoot}`
      ].join(' ');
  }
}

function buildPhaseHandoffMessage(currentRole, nextRole) {
  if (!nextRole) return '';
  return `${currentRole} fazası tamamlandı. İndi ${nextRole} kimi davam et və əvvəlki nəticəni input kimi istifadə et.`;
}

module.exports = {
  buildRoleInstruction,
  buildPhaseHandoffMessage
};

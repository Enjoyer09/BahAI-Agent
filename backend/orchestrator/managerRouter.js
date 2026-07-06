function classifyUserIntent(text = '') {
  const normalized = String(text || '').trim().toLowerCase();

  const isTiny = normalized.length > 0 && normalized.length < 120;
  const isQuestion = /\?$/.test(normalized) || /^(what|why|how|which|compare|explain|necə|niyə|hansı|fərq|roadmap|plan|sence)/i.test(normalized);
  const wantsAudit = /(audit|review|risk|finding|code review|security review|proqrami audit|qovlugu audit|yoxla)/i.test(normalized);
  const wantsImplementation = /(implement|build|fix|duzelt|düzəlt|əlavə et|add|integrate|qoş|qoşaq|bashla|başla)/i.test(normalized);
  const wantsInfra = /(deploy|docker|railway|vercel|env|ci|cd|logs|monitoring|kubernetes|k8s|nginx|devops)/i.test(normalized);
  const wantsBrowser = /(ui|frontend|page|screen|click|browser|playwright|screenshot)/i.test(normalized);
  const wantsGuiAgent = /(gui|computer use|desktop agent|use computer|mouse|keyboard|window|app automation|computer agent)/i.test(normalized);
  const wantsSeo = /(seo|marketing seo|technical seo|meta description|title tag|serp|keyword|keywords|search console|ga4|google analytics|google search console|wix seo|on-page seo)/i.test(normalized);
  const wantsStrategy = /(roadmap|compare|fərq|necə edək|hansı addım|which step|strategy|architecture)/i.test(normalized);

  return {
    normalized,
    isTiny,
    isQuestion,
    wantsAudit,
    wantsImplementation,
    wantsInfra,
    wantsBrowser,
    wantsGuiAgent,
    wantsSeo,
    wantsStrategy
  };
}

function decideManagerRoute({ latestUserText = '', orchestrationMode = false, workflow = 'default' }) {
  const intent = classifyUserIntent(latestUserText);
  const buildBudget = ({ maxSteps, agentCount, allowTools, preferDirect, compact = false }) => ({
    maxSteps,
    agentCount,
    allowTools,
    preferDirect,
    compact
  });

  if (!orchestrationMode) {
    return {
      mode: 'direct',
      primaryAgent: 'Solo Agent',
      secondaryAgents: [],
      workflow: 'solo',
      useTools: true,
      maxSteps: 4,
      reason: 'Orchestration söndürülüb',
      tokenDiscipline: buildBudget({ maxSteps: 4, agentCount: 1, allowTools: true, preferDirect: true })
    };
  }

  if (workflow === 'seo_gui' || (intent.wantsSeo && (intent.wantsGuiAgent || intent.wantsBrowser))) {
    return {
      mode: 'delegated',
      primaryAgent: 'Marketing SEO Specialist',
      secondaryAgents: ['GUI Operator', 'Reviewer'],
      workflow: 'seo_gui',
      useTools: true,
      maxSteps: 5,
      reason: 'SEO + GUI sorğusu üçün strategy + observation + safe execution axını lazımdır',
      tokenDiscipline: buildBudget({ maxSteps: 5, agentCount: 3, allowTools: true, preferDirect: false })
    };
  }

  if (workflow === 'computer_use' || /(computer use|desktop app|real desktop|mac app|mouse|keyboard|window|finder|system settings|local app)/i.test(intent.normalized)) {
    return {
      mode: 'delegated',
      primaryAgent: 'Computer Use Operator',
      secondaryAgents: [],
      workflow: 'computer_use',
      useTools: true,
      maxSteps: 5,
      reason: 'Desktop GUI sorğusu üçün browser yox, local computer-use axını daha uyğundur',
      tokenDiscipline: buildBudget({ maxSteps: 5, agentCount: 1, allowTools: true, preferDirect: true })
    };
  }

  if (workflow === 'gui' || intent.wantsGuiAgent || intent.wantsBrowser) {
    return {
      mode: 'delegated',
      primaryAgent: 'Planner',
      secondaryAgents: ['Builder', 'Reviewer'],
      workflow: 'gui',
      useTools: true,
      maxSteps: 5,
      reason: 'GUI / browser sorğusu üçün seçilmiş GUI observe -> action -> reflection axını lazımdır',
      tokenDiscipline: buildBudget({ maxSteps: 5, agentCount: 3, allowTools: true, preferDirect: false })
    };
  }

  if (intent.wantsStrategy || (intent.isQuestion && !intent.wantsImplementation && !intent.wantsAudit && !intent.wantsInfra)) {
    return {
      mode: 'direct',
      primaryAgent: 'Manager',
      secondaryAgents: [],
      workflow: 'manager-direct',
      useTools: false,
      maxSteps: 1,
      reason: 'Sual strateji/izah xarakterlidir; manager özü cavab verməlidir',
      tokenDiscipline: buildBudget({ maxSteps: 1, agentCount: 1, allowTools: false, preferDirect: true, compact: true })
    };
  }

  if (intent.wantsAudit) {
    return {
      mode: 'delegated',
      primaryAgent: 'Planner',
      secondaryAgents: ['Reviewer'],
      workflow: workflow === 'review-only' ? 'review-only' : 'default',
      useTools: true,
      maxSteps: 5,
      reason: 'Audit sorğusu üçün findings-first oxu və review axını lazımdır',
      tokenDiscipline: buildBudget({ maxSteps: 5, agentCount: 2, allowTools: true, preferDirect: false })
    };
  }

  if (intent.wantsInfra) {
    return {
      mode: 'delegated',
      primaryAgent: 'Planner',
      secondaryAgents: ['Builder', 'Reviewer'],
      workflow: workflow === 'thorough' ? 'thorough' : 'default',
      useTools: true,
      maxSteps: 5,
      reason: 'Infra/DevOps mövzusu plan + icra + risk yoxlaması tələb edir',
      tokenDiscipline: buildBudget({ maxSteps: 5, agentCount: 3, allowTools: true, preferDirect: false })
    };
  }

  if (intent.wantsImplementation) {
    return {
      mode: 'delegated',
      primaryAgent: 'Planner',
      secondaryAgents: workflow === 'quick' ? ['Implementer'] : ['Builder', 'Reviewer'],
      workflow: workflow || 'default',
      useTools: true,
      maxSteps: workflow === 'quick' ? 4 : 5,
      reason: 'İcra yönümlü sorğu üçün seçilmiş agent axını lazımdır',
      tokenDiscipline: buildBudget({ maxSteps: workflow === 'quick' ? 4 : 5, agentCount: workflow === 'quick' ? 1 : 3, allowTools: true, preferDirect: workflow === 'quick' })
    };
  }

  if (intent.isTiny && intent.isQuestion) {
    return {
      mode: 'direct',
      primaryAgent: 'Manager',
      secondaryAgents: [],
      workflow: 'manager-direct',
      useTools: false,
      maxSteps: 1,
      reason: 'Qısa sual üçün multi-agent axını artıq xərc yaradır',
      tokenDiscipline: buildBudget({ maxSteps: 1, agentCount: 1, allowTools: false, preferDirect: true, compact: true })
    };
  }

  return {
    mode: 'delegated',
    primaryAgent: 'Planner',
    secondaryAgents: ['Builder', 'Reviewer'],
    workflow: workflow || 'default',
    useTools: true,
    maxSteps: 5,
    reason: 'Default olaraq planner-first selective dispatch seçildi',
    tokenDiscipline: buildBudget({ maxSteps: 5, agentCount: 3, allowTools: true, preferDirect: false })
  };
}

module.exports = {
  classifyUserIntent,
  decideManagerRoute
};

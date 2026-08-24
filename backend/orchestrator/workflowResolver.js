const { getToolProfileForWorkflow } = require('../tools/profiles');
const { decideManagerRoute } = require('./managerRouter');

const ORCHESTRATION_WORKFLOWS = {
  quick: {
    mode: 'orchestrated',
    agents: ['Implementer'],
    plan: ['Tapşırığı qısa analiz et', 'Birbaşa implementasiya et', 'Əsas sanity check apar']
  },
  default: {
    mode: 'orchestrated',
    agents: ['Planner', 'Builder', 'Reviewer'],
    plan: ['Planner problemi hissələrə ayırır', 'Builder dəyişiklikləri tətbiq edir', 'Reviewer risk və boşluqları yoxlayır']
  },
  gui: {
    mode: 'solo',
    agents: ['Solo Agent'],
    plan: ['Ekrana bax, hərəkət et, nəticəni yoxla']
  },
  computer_use: {
    mode: 'solo',
    agents: ['Computer Use Operator'],
    plan: ['Desktop UI-ni müşahidə et', 'Təhlükəsiz local action et', 'Nəticəni yoxla və checkpoint saxla']
  },
  seo_gui: {
    mode: 'orchestrated',
    agents: ['Marketing SEO Specialist', 'GUI Operator', 'Reviewer'],
    plan: [
      'SEO specialist audit və intent planını qurur',
      'GUI operator paneli və ya saytı müşahidə edir',
      'Reviewer risk, publish/save təhlükəsi və boşluqları yoxlayır'
    ]
  },
  thorough: {
    mode: 'orchestrated',
    agents: ['Architect', 'Builder', 'Security', 'QA'],
    plan: ['Architect həll planını qurur', 'Builder kodu tətbiq edir', 'Security riskləri yoxlayır', 'QA test və regresiya baxışı edir']
  },
  'review-only': {
    mode: 'orchestrated',
    agents: ['Reviewer', 'Security'],
    plan: ['Kod bazasını oxu', 'Risk və uyğunsuzluqları topla', 'Dəyişikliksiz audit nəticəsi ver']
  }
};

function resolveOrchestrationConfig(orchestrationMode, workflow, latestUserText = '', options = {}) {
  if (options.productMode === 'web_chat') {
    return {
      enabled: false,
      workflow: 'solo',
      mode: 'solo',
      agents: ['Solo Agent'],
      plan: ['İstifadəçi sualını cavablandır', 'Lazımdırsa uyğun cloud tool istifadə et', 'Tək yekun cavab ver'],
      toolProfile: getToolProfileForWorkflow('solo'),
      routing: {
        mode: 'direct',
        primaryAgent: 'Solo Agent',
        secondaryAgents: [],
        workflow: 'solo',
        useTools: true,
        maxSteps: 2,
        reason: 'Web chat məhsulu üçün multi-agent orchestration söndürülüb',
      },
      maxSteps: 2
    };
  }
  const route = decideManagerRoute({ latestUserText, orchestrationMode, workflow });

  // FIX: Force solo mode for 'quick', 'gui', and 'solo' workflows regardless
  // of orchestrationMode toggle. These workflows are designed to run with a
  // single agent and break on token-limited APIs (FreeModel) when orchestrated.
  const forceSoloWorkflows = ['quick', 'gui', 'computer_use', 'solo'];
  const selectedWorkflowId = ORCHESTRATION_WORKFLOWS[route.workflow] ? route.workflow : 'default';

  if (forceSoloWorkflows.includes(selectedWorkflowId) || route.mode === 'direct') {
    return {
      enabled: false,
      workflow: selectedWorkflowId,
      mode: 'manager_direct',
      agents: ['Solo Agent'],
      plan: ORCHESTRATION_WORKFLOWS[selectedWorkflowId]?.plan || ['Sorğunu icra et'],
      toolProfile: getToolProfileForWorkflow('solo'),
      routing: { ...route, mode: 'direct', primaryAgent: 'Solo Agent', secondaryAgents: [] },
      maxSteps: route.maxSteps
    };
  }

  if (!orchestrationMode) {
    return {
      enabled: false,
      workflow: 'solo',
      mode: 'solo',
      agents: ['Solo Agent'],
      plan: ['Sorğunu analiz et', 'Lazım olan tool-ları işə sal', 'Nəticəni yekunlaşdır'],
      toolProfile: getToolProfileForWorkflow('solo'),
      routing: route,
      maxSteps: route.maxSteps
    };
  }

  const selected = ORCHESTRATION_WORKFLOWS[selectedWorkflowId];
  const delegatedAgents = [route.primaryAgent, ...(route.secondaryAgents || [])];

  return {
    enabled: true,
    workflow: selectedWorkflowId,
    mode: selected.mode,
    agents: delegatedAgents.length > 0 ? delegatedAgents : selected.agents,
    plan: selected.plan,
    toolProfile: getToolProfileForWorkflow(selectedWorkflowId),
    routing: route,
    maxSteps: route.maxSteps
  };
}

module.exports = {
  ORCHESTRATION_WORKFLOWS,
  resolveOrchestrationConfig
};

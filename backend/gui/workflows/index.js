// ==========================================
// GUI Workflows — Registry & Router
// ==========================================

const { buildSeoAgentPrompt, buildSeoWorkflowSteps, isSafeGuiAction, SEO_KNOWLEDGE } = require('./seo-audit');
const { runGuiWorkflow } = require('./engine');

/**
 * Available GUI workflows
 */
const WORKFLOWS = {
  'seo-audit': {
    id: 'seo-audit',
    name: 'SEO Audit',
    description: 'Navigate to a website dashboard, find SEO settings, analyze and propose fixes',
    platforms: ['wix', 'wordpress', 'shopify', 'squarespace'],
    buildSteps: buildSeoWorkflowSteps,
    buildPrompt: buildSeoAgentPrompt,
    knowledge: SEO_KNOWLEDGE
  }
};

/**
 * Detect which GUI workflow to use based on user message.
 */
function detectGuiWorkflow(userMessage = '') {
  const text = String(userMessage).toLowerCase();
  
  if (/(seo|search\s*engine|meta\s*description|sitemap|robots\.txt|google\s*search|axtarış)/i.test(text)) {
    return 'seo-audit';
  }

  return null;
}

/**
 * Check if a message is requesting a GUI workflow.
 */
function isGuiWorkflowRequest(text = '', workflow = '') {
  if (workflow === 'gui') return true;
  const value = String(text).toLowerCase();
  return (
    /(gui\s*agent|visible\s*browser|brauzerdə\s*aç|browser\s*aç|ekranda\s*göstər|vizual)/i.test(value) &&
    /(wix|wordpress|shopify|seo|settings|ayarlar|parametr)/i.test(value)
  );
}

module.exports = {
  WORKFLOWS,
  detectGuiWorkflow,
  isGuiWorkflowRequest,
  runGuiWorkflow,
  buildSeoAgentPrompt,
  buildSeoWorkflowSteps,
  isSafeGuiAction,
  SEO_KNOWLEDGE
};

// ==========================================
// GUI Workflow: SEO Audit (Wix & similar platforms)
// 
// Full autonomous workflow:
// 1. Open browser (visible) → navigate to target
// 2. Human checkpoint → wait for login
// 3. Navigate to SEO settings
// 4. Analyze SEO configuration
// 5. Propose fixes (with approval)
// 6. Apply approved changes
// ==========================================

const { groundElement, ocrTextGround, reflectOnAction } = require('../grounding');

/**
 * SEO knowledge base — common issues and how to fix them.
 * Used by the agent to understand what to look for.
 */
const SEO_KNOWLEDGE = {
  criticalChecks: [
    { id: 'title', label: 'Page Title', rule: '50-60 chars, unique per page, includes primary keyword' },
    { id: 'meta_description', label: 'Meta Description', rule: '150-160 chars, compelling CTA, includes keyword' },
    { id: 'h1', label: 'H1 Heading', rule: 'One H1 per page, matches search intent' },
    { id: 'canonical', label: 'Canonical URL', rule: 'Self-referencing canonical to prevent duplicates' },
    { id: 'sitemap', label: 'Sitemap', rule: 'Auto-generated, submitted to Google Search Console' },
    { id: 'robots', label: 'Robots.txt', rule: 'Not blocking important pages, allows crawlers' },
    { id: 'ssl', label: 'HTTPS', rule: 'All pages served over HTTPS' },
    { id: 'mobile', label: 'Mobile Friendly', rule: 'Responsive design, no horizontal scroll' },
  ],
  wixNavigation: {
    dashboard: ['Dashboard', 'Home', 'Əsas səhifə'],
    settings: ['Settings', 'Parametrlər', 'Ayarlar'],
    seo: ['SEO', 'SEO Tools', 'SEO Settings', 'Marketing & SEO', 'Marketing'],
    pages: ['Site Pages', 'Səhifələr', 'Pages'],
  },
  platforms: {
    wix: {
      seoPath: ['Marketing & SEO', 'SEO Tools', 'SEO Settings'],
      settingsPath: ['Settings'],
      pagesPath: ['Site Pages', 'Pages & Menu'],
    }
  }
};

/**
 * Build the GUI agent system prompt for SEO workflow.
 * This gives the LLM the context to navigate Wix and understand SEO.
 */
function buildSeoAgentPrompt({ platform = 'wix', goal = '', currentUrl = '', pageTitle = '' }) {
  return `You are an expert SEO agent operating a real browser visually. You can see the screen via screenshots.

PLATFORM: ${platform.toUpperCase()}
CURRENT PAGE: ${pageTitle} (${currentUrl})
GOAL: ${goal}

YOUR SEO EXPERTISE:
${SEO_KNOWLEDGE.criticalChecks.map(c => `- ${c.label}: ${c.rule}`).join('\n')}

NAVIGATION KNOWLEDGE (${platform}):
- To reach SEO settings: ${SEO_KNOWLEDGE.platforms[platform]?.seoPath?.join(' → ') || 'Look for Marketing/SEO menu'}
- Dashboard navigation items to look for: ${Object.values(SEO_KNOWLEDGE.wixNavigation).flat().join(', ')}

RULES:
1. NEVER click "Publish", "Save & Publish", or any destructive button without explicit user approval
2. NEVER enter payment information or change billing
3. ONLY observe and navigate — when you find something to change, STOP and report
4. If you're unsure where to click, take a screenshot and describe what you see
5. Move slowly — wait after each click for the page to load
6. If a popup/modal appears, close it first before continuing

RESPONSE FORMAT:
Return a JSON object with your next action. Available actions:
- {"type": "click_element", "description": "...", "confidence": 0.8, "reasoning": "..."}
- {"type": "click_xy", "x": 100, "y": 200, "reasoning": "..."}
- {"type": "type", "x": 100, "y": 200, "text": "...", "reasoning": "..."}
- {"type": "scroll", "y": -300, "reasoning": "..."}
- {"type": "wait", "ms": 2000, "reasoning": "..."}
- {"type": "navigate", "url": "...", "reasoning": "..."}
- {"type": "done", "reasoning": "..."}
- {"type": "report", "findings": [...], "recommendations": [...], "reasoning": "..."}

When you find SEO settings, return a "report" action with your findings instead of making changes.`;
}

/**
 * Build the workflow steps for the SEO audit.
 * Returns an ordered list of high-level steps the agent should follow.
 */
function buildSeoWorkflowSteps({ url = 'https://www.wix.com', platform = 'wix' }) {
  return [
    {
      id: 'open_browser',
      instruction: `Navigate to ${url}`,
      action: { type: 'navigate', url },
      requiresHuman: false
    },
    {
      id: 'wait_login',
      instruction: 'İstifadəçinin login olmasını gözlə',
      action: null,
      requiresHuman: true,
      humanCheckpoint: {
        kind: 'login',
        title: 'Wix-ə Daxil Olun',
        message: `Brauzerdə ${url} açılıb. Zəhmət olmasa hesabınıza daxil olun. Login bitəndə "Login oldum" düyməsini basın.`,
        resumePrompt: 'İstifadəçi login oldu. İndi dashboard-a bax və SEO Settings-ə get.',
        cancelPrompt: 'İstifadəçi ləğv etdi.'
      }
    },
    {
      id: 'find_seo_settings',
      instruction: 'Dashboard-da SEO Settings-i tap. Sol menyuda "Marketing & SEO" və ya "SEO Tools" axtar.',
      action: null, // Agent decides based on screenshot
      requiresHuman: false,
      maxAttempts: 8,
      successCriteria: 'SEO settings page is visible'
    },
    {
      id: 'analyze_seo',
      instruction: 'SEO parametrlərini oxu və analiz et. Title, meta description, sitemap, robots.txt vəziyyətini yoxla.',
      action: null,
      requiresHuman: false,
      maxAttempts: 5,
      successCriteria: 'SEO report generated'
    },
    {
      id: 'report_findings',
      instruction: 'Tapıntıları istifadəçiyə bildir. Hər düzəliş üçün ayrıca approval soruş.',
      action: null,
      requiresHuman: true
    }
  ];
}

/**
 * Dangerous patterns that the agent must NEVER interact with.
 */
const DANGEROUS_PATTERNS = [
  /publish/i,
  /save\s*&?\s*publish/i,
  /go\s*live/i,
  /delete\s*(site|page|all)/i,
  /remove\s*(site|page)/i,
  /cancel\s*(subscription|plan)/i,
  /upgrade/i,
  /billing/i,
  /payment/i,
  /downgrade/i,
];

/**
 * Check if an action is safe to execute.
 */
function isSafeGuiAction(action = {}) {
  const text = JSON.stringify(action).toLowerCase();
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(text)) {
      return {
        safe: false,
        reason: `Action matches dangerous pattern: ${pattern}. Blocked for safety.`,
        pattern: pattern.toString()
      };
    }
  }
  return { safe: true };
}

/**
 * Parse an SEO report from the agent's response.
 */
function parseSeoReport(agentResponse = '') {
  try {
    const json = JSON.parse(agentResponse);
    if (json.type === 'report') {
      return {
        findings: Array.isArray(json.findings) ? json.findings : [],
        recommendations: Array.isArray(json.recommendations) ? json.recommendations : [],
        summary: json.reasoning || ''
      };
    }
  } catch {}

  // Try to extract structured info from text
  return {
    findings: [],
    recommendations: [],
    summary: agentResponse
  };
}

module.exports = {
  SEO_KNOWLEDGE,
  buildSeoAgentPrompt,
  buildSeoWorkflowSteps,
  isSafeGuiAction,
  parseSeoReport,
  DANGEROUS_PATTERNS
};

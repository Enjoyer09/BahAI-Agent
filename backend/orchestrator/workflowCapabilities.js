const WORKFLOW_CAPABILITIES = {
  quick: {
    capabilities: ['code', 'edit', 'validation-lite'],
    recommendedModelClass: 'fast_coder',
    evidence: ['static_contract'],
    humanGatePolicy: 'minimal'
  },
  default: {
    capabilities: ['code', 'edit', 'review', 'validation'],
    recommendedModelClass: 'balanced_coder',
    evidence: ['static_contract', 'unit_or_integration'],
    humanGatePolicy: 'normal'
  },
  gui: {
    capabilities: ['browser', 'visual_observation', 'checkpoint'],
    recommendedModelClass: 'vision_reasoner',
    evidence: ['live_smoke'],
    humanGatePolicy: 'strict_for_sensitive_actions'
  },
  seo_gui: {
    capabilities: ['browser', 'visual_observation', 'seo_audit', 'checkpoint', 'review'],
    recommendedModelClass: 'vision_reasoner_plus_strategy',
    evidence: ['live_smoke', 'manual_oracle'],
    humanGatePolicy: 'strict_for_save_publish'
  },
  thorough: {
    capabilities: ['architecture', 'code', 'security', 'qa'],
    recommendedModelClass: 'frontier_reasoner',
    evidence: ['static_contract', 'unit_or_integration', 'frontend_build'],
    humanGatePolicy: 'normal'
  },
  'review-only': {
    capabilities: ['audit', 'security_review', 'reporting'],
    recommendedModelClass: 'reasoner',
    evidence: ['static_contract'],
    humanGatePolicy: 'none'
  }
};

function getWorkflowCapabilities(workflow = 'default') {
  return WORKFLOW_CAPABILITIES[workflow] || WORKFLOW_CAPABILITIES.default;
}

module.exports = {
  WORKFLOW_CAPABILITIES,
  getWorkflowCapabilities
};

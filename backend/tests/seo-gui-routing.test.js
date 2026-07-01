import { describe, it, expect } from 'vitest';

const { decideManagerRoute } = require('../orchestrator/managerRouter');
const { resolveOrchestrationConfig } = require('../orchestrator/workflowResolver');

describe('seo_gui routing', () => {
  it('routes SEO + GUI intent into seo_gui workflow', () => {
    const route = decideManagerRoute({
      latestUserText: 'Wix saytimi SEO baximindan yoxla, GUI agentle settings-lere gir ve meta description hisselerini tap.',
      orchestrationMode: true,
      workflow: 'default'
    });

    expect(route.workflow).toBe('seo_gui');
    expect(route.primaryAgent).toBe('Marketing SEO Specialist');
  });

  it('resolves seo_gui orchestration config with dedicated agents', () => {
    const config = resolveOrchestrationConfig(true, 'seo_gui', 'Wix SEO settings-i GUI ile yoxla');

    expect(config.workflow).toBe('seo_gui');
    expect(config.enabled).toBe(true);
    expect(config.agents).toContain('Marketing SEO Specialist');
    expect(config.agents).toContain('GUI Operator');
  });
});

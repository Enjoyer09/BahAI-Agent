function classifyEntryPath({ latestUserText = '', workflow = 'default', orchestration = null } = {}) {
  const text = String(latestUserText || '').toLowerCase();

  if (workflow === 'review-only' || /audit|review|risk|security review|code review|yoxla/.test(text)) {
    return { mode: 'audit', reason: 'Existing repo / audit-first sorğusu' };
  }

  if (workflow === 'seo_gui' || /seo|marketing|search console|meta description|title tag/.test(text)) {
    return { mode: 'spec-intake', reason: 'SEO / strategy / structured workflow sorğusu' };
  }

  if (workflow === 'gui' || workflow === 'computer_use' || /gui|computer use|desktop|browser|visible browser/.test(text)) {
    return { mode: 'bootstrap', reason: 'Interactive tool-driven execution sorğusu' };
  }

  if (orchestration?.enabled) {
    return { mode: 'spec-intake', reason: 'Multi-phase orchestration sorğusu' };
  }

  return { mode: 'bootstrap', reason: 'Direct implementation / answer sorğusu' };
}

function buildGateReceipt({
  entryPath,
  plannerArtifact = null,
  executionArtifacts = [],
  projectMemory = {},
  runId = '',
  workflow = 'default'
} = {}) {
  const lastValidation = projectMemory?.lastValidation || null;
  const lastApprovalDecision = projectMemory?.lastApprovalDecision || null;
  const lastBrowserArtifact = projectMemory?.lastBrowserArtifact || null;
  const lastGuiArtifact = projectMemory?.lastGuiArtifact || null;
  const recentExecution = Array.isArray(executionArtifacts) ? executionArtifacts.slice(-3) : [];

  const evidence = [
    { label: 'planner', status: plannerArtifact ? 'ok' : 'missing', summary: plannerArtifact?.summary || plannerArtifact?.goal || 'Planner artifact yoxdur' },
    { label: 'validation', status: lastValidation?.status || 'missing', summary: lastValidation?.summary || 'Validation evidence yoxdur' },
    { label: 'gui', status: lastGuiArtifact?.status || lastBrowserArtifact?.status || 'missing', summary: lastGuiArtifact?.summary || lastBrowserArtifact?.summary || 'GUI/browser evidence yoxdur' },
    { label: 'approval', status: lastApprovalDecision?.decision === 'reject' ? 'failed' : (lastApprovalDecision ? 'ok' : 'missing'), summary: lastApprovalDecision?.title || lastApprovalDecision?.summary || 'Approval decision yoxdur' }
  ];

  const failed = evidence.filter((item) => item.status === 'failed').length;
  const missing = evidence.filter((item) => item.status === 'missing').length;
  const overall = failed > 0 ? 'blocked' : (missing > 1 ? 'partial' : 'ready');

  return {
    runId,
    workflow,
    entryPath,
    overall,
    evidence,
    handoff: {
      plannerGoal: plannerArtifact?.goal || '',
      nextFocus: recentExecution.map((item) => item?.summary).filter(Boolean).slice(-2),
      unresolvedRisk: failed > 0 ? 'Failed evidence var' : (missing > 1 ? 'Bəzi evidence hələ toplanmayıb' : '')
    }
  };
}

module.exports = {
  classifyEntryPath,
  buildGateReceipt
};

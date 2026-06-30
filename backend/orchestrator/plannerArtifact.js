function emptyPlannerArtifact() {
  return {
    goal: '',
    filesToInspect: [],
    suspectedRisks: [],
    implementationSteps: [],
    verificationSteps: [],
    workUnits: [],
    summary: ''
  };
}

function normalizeList(items = []) {
  return Array.from(new Set(
    items
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 12)
  ));
}

function extractBulletSection(text, headings) {
  const lines = String(text || '').split('\n');
  const lowerHeadings = headings.map((heading) => heading.toLowerCase());
  let active = false;
  const items = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const lower = line.toLowerCase();

    if (lowerHeadings.some((heading) => lower.startsWith(heading))) {
      active = true;
      continue;
    }

    if (active && /^(goal|məqsəd|files|fayllar|risks|risklər|steps|addımlar|verification|yoxlama|summary|yekun)/i.test(line)) {
      active = false;
    }

    if (!active) continue;

    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (bulletMatch) items.push(bulletMatch[1]);
    else if (numberedMatch) items.push(numberedMatch[1]);
  }

  return normalizeList(items);
}

function extractPlannerArtifact(messageContent = '', fallbackGoal = '') {
  const text = String(messageContent || '').trim();
  const artifact = emptyPlannerArtifact();
  artifact.goal = fallbackGoal || text.split('\n')[0] || '';
  artifact.filesToInspect = extractBulletSection(text, ['files to inspect', 'fayllar', 'oxunacaq fayllar']);
  artifact.suspectedRisks = extractBulletSection(text, ['suspected risks', 'risklər', 'riskler']);
  artifact.implementationSteps = extractBulletSection(text, ['implementation steps', 'icra addımları', 'addımlar', 'steps']);
  artifact.verificationSteps = extractBulletSection(text, ['verification steps', 'yoxlama addımları', 'verification']);
  artifact.workUnits = extractWorkUnits(text);
  artifact.summary = text.slice(0, 1200);

  if (!artifact.implementationSteps.length) {
    artifact.implementationSteps = normalizeList(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[-*•]|\d+\./.test(line))
        .map((line) => line.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, ''))
    );
  }

  return artifact;
}

function extractWorkUnits(text) {
  const lines = String(text || '').split('\n');
  const workUnits = [];
  let active = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const lower = line.toLowerCase();

    if (/^(work units|iş vahidləri|is vahidleri|parallel plan)/i.test(lower)) {
      active = true;
      continue;
    }

    if (active && /^(goal|məqsəd|files|fayllar|risks|risklər|steps|addımlar|verification|yoxlama|summary|yekun)/i.test(line)) {
      active = false;
    }

    if (!active) continue;
    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    const entry = bulletMatch?.[1] || numberedMatch?.[1];
    if (!entry) continue;

    const parallel = /\b(parallel|paralel)\b/i.test(entry);
    const blockedBy = entry.match(/\bafter:\s*([a-z0-9 _-]+)/i)?.[1]?.trim() || '';
    const role = entry.match(/\brole:\s*([a-z0-9 _-]+)/i)?.[1]?.trim() || '';
    const label = entry
      .replace(/\b(parallel|paralel)\b/ig, '')
      .replace(/\bafter:\s*[a-z0-9 _-]+\b/ig, '')
      .replace(/\brole:\s*[a-z0-9 _-]+\b/ig, '')
      .trim();

    workUnits.push({
      label: label.slice(0, 200),
      parallel,
      blockedBy,
      role
    });
  }

  return workUnits.slice(0, 10);
}

function buildPlannerArtifactPrompt() {
  return [
    'Cavabını mümkün qədər bu quruluşla ver:',
    'Məqsəd:',
    '- ...',
    'Oxunacaq fayllar:',
    '- ...',
    'Risklər:',
    '- ...',
    'İcra addımları:',
    '- ...',
    'Yoxlama addımları:',
    '- stack-ə uyğun lint / type-check / test / build',
    'İş vahidləri:',
    '- role: Builder parallel ...',
    '- role: Reviewer after: Builder ...',
    'Repo profili məlumdursa, yoxlama addımlarında həmin build/test/lint siqnallarına uyğun konkret komandaları yaz.'
  ].join('\n');
}

function buildPlannerArtifactContext(artifact) {
  if (!artifact) return '';
  return [
    'Planner Artifact:',
    `Goal: ${artifact.goal || ''}`,
    `Files: ${(artifact.filesToInspect || []).join(', ')}`,
    `Risks: ${(artifact.suspectedRisks || []).join(' | ')}`,
    `Implementation Steps: ${(artifact.implementationSteps || []).join(' | ')}`,
    `Verification Steps: ${(artifact.verificationSteps || []).join(' | ')}`,
    `Work Units: ${(artifact.workUnits || []).map((item) => `${item.label}${item.parallel ? ' [parallel]' : ''}${item.blockedBy ? ` [after:${item.blockedBy}]` : ''}${item.role ? ` [role:${item.role}]` : ''}`).join(' | ')}`,
    `Summary: ${artifact.summary || ''}`
  ].join('\n');
}

module.exports = {
  emptyPlannerArtifact,
  extractPlannerArtifact,
  buildPlannerArtifactPrompt,
  buildPlannerArtifactContext
};

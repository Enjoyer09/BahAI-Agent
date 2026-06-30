function buildPhases(orchestration) {
  if (!orchestration?.enabled) {
    return [{ role: orchestration?.agents?.[0] || 'Solo Agent', status: 'pending' }];
  }

  return (orchestration.agents || ['Solo Agent']).map((role) => ({
    role,
    status: 'pending'
  }));
}

function createRunManager(orchestration, runId) {
  const phases = buildPhases(orchestration);
  let currentIndex = 0;
  let plannerArtifact = null;
  let executionArtifacts = [];
  phases[0].status = 'active';

  function currentPhase() {
    return phases[currentIndex];
  }

  function markCurrentCompleted() {
    if (phases[currentIndex]) {
      phases[currentIndex].status = 'completed';
    }
  }

  function canAdvance() {
    return currentIndex < phases.length - 1;
  }

  function advance() {
    if (!canAdvance()) return null;
    markCurrentCompleted();
    currentIndex += 1;
    phases[currentIndex].status = 'active';
    return phases[currentIndex];
  }

  function snapshot() {
    return {
      runId,
      currentRole: currentPhase()?.role || 'Solo Agent',
      plannerArtifact,
      executionArtifacts,
      workUnits: plannerArtifact?.workUnits || [],
      phases: phases.map((phase, index) => ({
        role: phase.role,
        status: index < currentIndex
          ? 'completed'
          : index === currentIndex
            ? phase.status
            : 'pending'
      }))
    };
  }

  return {
    runId,
    currentPhase,
    canAdvance,
    advance,
    markCurrentCompleted,
    getPlannerArtifact: () => plannerArtifact,
    setPlannerArtifact: (artifact) => {
      plannerArtifact = artifact;
    },
    getExecutionArtifacts: () => executionArtifacts,
    addExecutionArtifact: (artifact) => {
      executionArtifacts = [...executionArtifacts, artifact].slice(-12);
    },
    snapshot
  };
}

module.exports = {
  createRunManager
};

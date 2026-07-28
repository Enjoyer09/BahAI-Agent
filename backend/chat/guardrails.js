// ==========================================
// Execution Safety Guardrails
// Prevents infinite loops, duplicate tool thrashing,
// and runaway process resource consumption.
// ==========================================

class ExecutionGuardrails {
  constructor(options = {}) {
    this.maxToolCallsPerSession = options.maxToolCallsPerSession || 25;
    this.maxDuplicateToolThreshold = options.maxDuplicateToolThreshold || 4;
    this.maxMutationsPerFile = options.maxMutationsPerFile || 6;
    
    this.toolCallCount = 0;
    this.toolHistory = [];
    this.fileMutationCounts = new Map();
  }

  validateToolCall(toolName, args = {}) {
    this.toolCallCount += 1;

    // 1. Session-level total tool count limit
    if (this.toolCallCount > this.maxToolCallsPerSession) {
      return {
        allowed: false,
        reason: `🛑 Safety Guardrail: Bir sessiyada maksimum alət limiti (${this.maxToolCallsPerSession}) aşıldı. Sonsuz dövrənin qarşısını almaq üçün icra dayandırıldı.`
      };
    }

    // 2. Consecutive duplicate tool thrashing detection
    const argsKey = JSON.stringify(args);
    const callSignature = `${toolName}:${argsKey}`;
    this.toolHistory.push(callSignature);

    const recent = this.toolHistory.slice(-this.maxDuplicateToolThreshold);
    if (recent.length >= this.maxDuplicateToolThreshold && recent.every(item => item === callSignature)) {
      return {
        allowed: false,
        reason: `🛑 Safety Guardrail: '${toolName}' aləti eyni parametrlərlə ${this.maxDuplicateToolThreshold} dəfə ard-arda təkrar olundu. Agent dövrəyə düşdüyü üçün dayandırıldı.`
      };
    }

    // 3. File mutation limit (prevent continuous overwriting of single file)
    if (['write_file', 'file_edit', 'multi_file_edit'].includes(toolName)) {
      const filePath = args.path || (args.edits && args.edits[0]?.path) || 'unknown';
      const currentMutations = (this.fileMutationCounts.get(filePath) || 0) + 1;
      this.fileMutationCounts.set(filePath, currentMutations);

      if (currentMutations > this.maxMutationsPerFile) {
        return {
          allowed: false,
          reason: `🛑 Safety Guardrail: '${filePath}' faylı 1 sessiyada ${this.maxMutationsPerFile} dəfədən çox redaktə olundu. Faylın pozulmaması üçün əməliyyat dayandırıldı.`
        };
      }
    }

    return { allowed: true };
  }
}

function createGuardrails(options) {
  return new ExecutionGuardrails(options);
}

module.exports = {
  ExecutionGuardrails,
  createGuardrails
};

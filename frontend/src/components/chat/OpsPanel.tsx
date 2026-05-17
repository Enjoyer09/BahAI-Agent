import { useState } from 'react';

interface PendingApproval {
  approvalId: string;
  tool: string;
  args: string;
}

interface OpsPanelProps {
  safeMode: boolean;
  setSafeMode: (value: boolean) => void;
  taskPlan: string[];
  pendingApprovals: PendingApproval[];
  onDecideApproval: (approvalId: string, decision: 'approve' | 'reject') => Promise<void>;
  onHealthCheck: () => Promise<void>;
  onTerminalRun: (command: string) => Promise<void>;
  onDiffPreview: (path: string, newContent: string) => Promise<{ diff: string }>;
  onDiffApply: (path: string, newContent: string) => Promise<void>;
}

export default function OpsPanel({
  safeMode,
  setSafeMode,
  taskPlan,
  pendingApprovals,
  onDecideApproval,
  onHealthCheck,
  onTerminalRun,
  onDiffPreview,
  onDiffApply
}: OpsPanelProps) {
  const [command, setCommand] = useState('npm run build');
  const [diffPath, setDiffPath] = useState('');
  const [diffContent, setDiffContent] = useState('');
  const [diffPreview, setDiffPreview] = useState('');
  const [running, setRunning] = useState(false);

  const handleHealthCheck = async () => {
    setRunning(true);
    try {
      await onHealthCheck();
    } finally {
      setRunning(false);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    try {
      await onTerminalRun(command);
    } finally {
      setRunning(false);
    }
  };

  const handlePreview = async () => {
    const result = await onDiffPreview(diffPath, diffContent);
    setDiffPreview(result.diff || '');
  };

  const handleApply = async () => {
    await onDiffApply(diffPath, diffContent);
    setDiffPreview('');
  };

  return (
    <div className="w-96 bg-[var(--bg-surface)]/40 backdrop-blur-xl border border-white/5 rounded-3xl p-4 overflow-y-auto space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-widest text-blue-400">Ops Panel</h3>
        <label className="flex items-center gap-2 text-xs">
          <span>Safe Mode</span>
          <input type="checkbox" checked={safeMode} onChange={(e) => setSafeMode(e.target.checked)} />
        </label>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-gray-500">Task Plan</div>
        <ul className="space-y-1 text-xs text-gray-300">
          {(taskPlan.length ? taskPlan : ['Hələ plan yoxdur']).map((item, idx) => (
            <li key={idx} className="p-2 rounded-lg bg-white/5">{item}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-gray-500">Pending Approvals</div>
        <div className="space-y-2">
          {pendingApprovals.length === 0 && <div className="text-xs text-gray-500">Pending approval yoxdur</div>}
          {pendingApprovals.map((item) => (
            <div key={item.approvalId} className="p-2 rounded-lg bg-white/5 text-xs space-y-2">
              <div className="font-semibold">{item.tool}</div>
              <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-gray-400">{item.args}</pre>
              <div className="flex gap-2">
                <button className="px-2 py-1 bg-green-600 rounded text-white" onClick={() => onDecideApproval(item.approvalId, 'approve')}>Apply</button>
                <button className="px-2 py-1 bg-red-600 rounded text-white" onClick={() => onDecideApproval(item.approvalId, 'reject')}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-gray-500">Project Health Check</div>
        <button className="w-full px-3 py-2 bg-blue-600 rounded text-white text-xs font-bold" onClick={handleHealthCheck} disabled={running}>
          Layihəni Yoxla
        </button>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-gray-500">Terminal Command</div>
        <input value={command} onChange={(e) => setCommand(e.target.value)} className="w-full px-2 py-2 rounded bg-black/20 border border-white/10 text-xs" />
        <button className="w-full px-3 py-2 bg-white/10 rounded text-xs font-bold" onClick={handleRun} disabled={running}>Run</button>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-gray-500">Diff Preview</div>
        <input value={diffPath} onChange={(e) => setDiffPath(e.target.value)} placeholder="src/App.tsx" className="w-full px-2 py-2 rounded bg-black/20 border border-white/10 text-xs" />
        <textarea value={diffContent} onChange={(e) => setDiffContent(e.target.value)} placeholder="Yeni fayl məzmunu..." className="w-full px-2 py-2 rounded bg-black/20 border border-white/10 text-xs h-28" />
        <div className="flex gap-2">
          <button className="flex-1 px-3 py-2 bg-white/10 rounded text-xs font-bold" onClick={handlePreview}>Preview</button>
          <button className="flex-1 px-3 py-2 bg-green-600 rounded text-xs font-bold text-white" onClick={handleApply}>Apply</button>
        </div>
        {diffPreview && <pre className="text-[11px] whitespace-pre-wrap overflow-x-auto p-2 rounded bg-black/20 border border-white/10">{diffPreview}</pre>}
      </div>
    </div>
  );
}

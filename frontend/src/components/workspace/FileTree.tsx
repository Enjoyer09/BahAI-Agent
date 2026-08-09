// ==========================================
// FileTree — Virtualized file tree with IPC data source
// ==========================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Plus, FilePlus, Trash2, Edit3 } from 'lucide-react';

export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked' | 'clean';
}

interface FileTreeProps {
  workingDirectory: string;
  onFileSelect: (absolutePath: string) => void;
  gitStatusMap?: Record<string, string>;
  selectedFile?: string | null;
}

const FILE_ICONS: Record<string, string> = {
  ts: '🟦', tsx: '⚛️', js: '🟨', jsx: '⚛️',
  json: '📋', md: '📝', css: '🎨', html: '🌐',
  py: '🐍', rs: '🦀', go: '🐹', java: '☕',
  yml: '⚙️', yaml: '⚙️', toml: '⚙️',
  png: '🖼️', jpg: '🖼️', svg: '🖼️', gif: '🖼️',
  lock: '🔒', env: '🔐',
};

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || '📄';
}

function getGitColor(status?: string): string {
  switch (status) {
    case 'modified': return 'var(--color-warning)';
    case 'added': return 'var(--color-success)';
    case 'deleted': return 'var(--color-danger)';
    case 'untracked': return '#888';
    default: return 'var(--fg-main)';
  }
}

// Single tree node component
function TreeNode({
  node,
  depth,
  workingDirectory,
  expandedDirs,
  toggleDir,
  onFileSelect,
  selectedFile,
  gitStatusMap,
}: {
  node: FileNode;
  depth: number;
  workingDirectory: string;
  expandedDirs: Set<string>;
  toggleDir: (id: string) => void;
  onFileSelect: (path: string) => void;
  selectedFile?: string | null;
  gitStatusMap?: Record<string, string>;
}) {
  const isDir = node.type === 'directory';
  const isExpanded = expandedDirs.has(node.id);
  const absolutePath = `${workingDirectory}/${node.id}`;
  const isSelected = selectedFile === absolutePath;
  const gitStatus = gitStatusMap?.[node.id];

  const handleClick = () => {
    if (isDir) {
      toggleDir(node.id);
    } else {
      onFileSelect(absolutePath);
    }
  };

  return (
    <>
      <div
        onClick={handleClick}
        className={`flex items-center gap-1.5 py-[3px] px-2 cursor-pointer text-[12px] hover:bg-[var(--bg-hover)] rounded-md transition-colors select-none ${
          isSelected ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : ''
        }`}
        style={{
          paddingLeft: `${depth * 14 + 8}px`,
          color: isSelected ? 'var(--color-accent)' : getGitColor(gitStatus),
        }}
        title={node.id}
      >
        {/* Expand/collapse arrow for dirs */}
        {isDir ? (
          <span className="w-4 h-4 flex items-center justify-center shrink-0 opacity-60">
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}

        {/* Icon */}
        <span className="shrink-0 text-[11px]">
          {isDir ? (isExpanded ? '📂' : '📁') : getFileIcon(node.name)}
        </span>

        {/* Name */}
        <span className="truncate flex-1 leading-tight">{node.name}</span>

        {/* Git status dot */}
        {gitStatus && gitStatus !== 'clean' && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: getGitColor(gitStatus) }}
          />
        )}
      </div>

      {/* Children */}
      {isDir && isExpanded && node.children && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              workingDirectory={workingDirectory}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
              gitStatusMap={gitStatusMap}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Main FileTree component
export default function FileTree({ workingDirectory, onFileSelect, gitStatusMap, selectedFile }: FileTreeProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load directory tree via IPC or API
  const loadTree = useCallback(async () => {
    if (!workingDirectory) return;
    setLoading(true);
    setError(null);

    try {
      const electron = (window as any).electron;
      if (electron?.fs?.readDirectory) {
        // Desktop: use IPC
        const nodes = await electron.fs.readDirectory(workingDirectory, 3);
        setTree(nodes);
      } else {
        // Web fallback: use backend API
        const token = localStorage.getItem('auth_token');
        const res = await fetch(`/api/files?path=${encodeURIComponent(workingDirectory)}`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          setTree(data.tree || data.files || []);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Fayl ağacı yüklənə bilmədi');
    } finally {
      setLoading(false);
    }
  }, [workingDirectory]);

  // Initial load
  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // Wire up file watcher (Desktop only)
  useEffect(() => {
    const electron = (window as any).electron;
    if (!electron?.fs?.onBatchChanged) return;

    // Start watching
    electron.fs.watchStart(workingDirectory).catch(() => {});

    const dispose = electron.fs.onBatchChanged(() => {
      // Refresh tree on any file changes
      loadTree();
    });

    return () => {
      dispose();
      electron.fs.watchStop().catch(() => {});
    };
  }, [workingDirectory, loadTree]);

  const toggleDir = useCallback((id: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <span className="text-xs text-[var(--fg-muted)] animate-pulse">Yüklənir...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-2">
        <span className="text-xs text-[var(--color-danger)]">{error}</span>
        <button onClick={loadTree} className="text-xs text-[var(--color-accent)] hover:underline">
          Yenidən yüklə
        </button>
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <span className="text-xs text-[var(--fg-muted)]">Boş qovluq</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
          Fayllar
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={loadTree}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--fg-muted)]"
            title="Yenilə"
          >
            <Folder size={12} />
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1 premium-scroll">
        {tree.map(node => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            workingDirectory={workingDirectory}
            expandedDirs={expandedDirs}
            toggleDir={toggleDir}
            onFileSelect={onFileSelect}
            selectedFile={selectedFile}
            gitStatusMap={gitStatusMap}
          />
        ))}
      </div>
    </div>
  );
}

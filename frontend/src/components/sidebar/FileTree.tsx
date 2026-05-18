import { useState, useEffect } from 'react';
import { Folder, File, ChevronRight, ChevronDown } from 'lucide-react';
import { fetchFileTree } from '../../lib/api';
import { Spinner } from '../common/UI';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface Props {
  projectPath: string;
  onFileSelect?: (path: string) => void;
  selectedPath?: string;
}

export default function FileTree({ projectPath, onFileSelect, selectedPath }: Props) {
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectPath) { setNodes([]); return; }
    setLoading(true);
    fetchFileTree('.', projectPath)
      .then(data => { if (Array.isArray(data)) setNodes(data); else setNodes([]); })
      .catch(() => setNodes([]))
      .finally(() => setLoading(false));
  }, [projectPath]);

  const toggle = (path: string) => setExpanded(prev => ({ ...prev, [path]: !prev[path] }));

  const renderNode = (node: FileNode, depth = 0) => {
    if (!node) return null;
    const isExpanded = expanded[node.path];
    const isSelected = selectedPath === node.path;

    return (
      <div key={node.path}>
        <button
          onClick={() => node.type === 'directory' ? toggle(node.path) : onFileSelect?.(node.path)}
          className="w-full flex items-center gap-1.5 py-1 text-left transition-colors"
          style={{
            paddingLeft: `${depth * 12 + 8}px`,
            paddingRight: '8px',
            background: isSelected ? 'var(--color-accent-muted)' : 'transparent',
            color: isSelected ? 'var(--color-accent)' : 'var(--fg-secondary)',
          }}
          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
          aria-expanded={node.type === 'directory' ? isExpanded : undefined}
        >
          {node.type === 'directory' ? (
            <>
              <span style={{ color: 'var(--fg-muted)' }}>
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
              <Folder size={13} style={{ color: 'var(--color-accent)', opacity: 0.7 }} />
            </>
          ) : (
            <>
              <span style={{ width: 12 }} />
              <File size={13} style={{ color: 'var(--fg-muted)' }} />
            </>
          )}
          <span className="text-xs truncate flex-1">{node.name}</span>
        </button>

        {node.type === 'directory' && isExpanded && node.children && (
          <div style={{ borderLeft: '1px solid var(--border-subtle)', marginLeft: `${depth * 12 + 16}px` }}>
            {Array.isArray(node.children) && node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (!projectPath) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>No project selected</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto premium-scroll py-1">
      {loading && nodes.length === 0 ? (
        <div className="flex items-center justify-center p-4">
          <Spinner size={16} />
        </div>
      ) : (
        nodes.map(node => renderNode(node))
      )}
    </div>
  );
}

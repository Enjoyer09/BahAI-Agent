// ==========================================
// FileTree — Standardized API & Safe Version
// ==========================================

import { useState, useEffect } from 'react';
import { Folder, File, ChevronRight, ChevronDown } from 'lucide-react';
import { fetchFileTree } from '../../lib/api';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface FileTreeProps {
  projectPath: string; // Audit: Renamed from projectDir for consistency
  onFileSelect?: (path: string) => void;
  selectedPath?: string;
}

export default function FileTree({ projectPath, onFileSelect, selectedPath }: FileTreeProps) {
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectPath) {
      setNodes([]);
      return;
    }
    
    setLoading(true);
    fetchFileTree('.', projectPath) // Audit: dirPath relative to workingDirectory
      .then(data => {
        if (Array.isArray(data)) {
          setNodes(data);
        } else {
          setNodes([]);
        }
      })
      .catch(err => {
        console.error('Failed to fetch files:', err);
        setNodes([]);
      })
      .finally(() => setLoading(false));
  }, [projectPath]);

  const toggle = (path: string) => {
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }));
    // Future: Fetch children if needed for recursive tree
  };

  const renderNode = (node: FileNode) => {
    if (!node) return null;
    const isExpanded = expanded[node.path];
    const isSelected = selectedPath === node.path;

    return (
      <div key={node.path} className="select-none">
        <div 
          onClick={() => node.type === 'directory' ? toggle(node.path) : onFileSelect?.(node.path)}
          className={`flex items-center gap-1 px-3 py-1.5 cursor-pointer text-[13px] hover:bg-white/5 transition-colors group ${isSelected ? 'bg-blue-500/15 text-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
        >
          {node.type === 'directory' ? (
            <>
              <div className="w-4 flex items-center justify-center">
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </div>
              <Folder size={14} className="text-blue-500/70 group-hover:text-blue-400" />
            </>
          ) : (
            <>
              <div className="w-4" />
              <File size={14} className="text-gray-600 group-hover:text-gray-400" />
            </>
          )}
          <span className="truncate flex-1 font-medium">{node.name}</span>
        </div>
        {node.type === 'directory' && isExpanded && node.children && (
          <div className="ml-4 border-l border-white/5">
            {Array.isArray(node.children) && node.children.map(child => renderNode(child))}
          </div>
        )}
      </div>
    );
  };

  if (!projectPath) return <div className="p-8 text-center text-xs text-gray-500 uppercase tracking-widest font-black opacity-30">Seçilməyib</div>;

  return (
    <div className="flex-1 overflow-y-auto py-2 scrollbar-hide">
      {loading && nodes.length === 0 ? (
        <div className="px-4 py-2 text-[10px] uppercase tracking-widest text-blue-500 animate-pulse font-black">Yüklənir...</div>
      ) : (
        nodes.map(node => renderNode(node))
      )}
    </div>
  );
}

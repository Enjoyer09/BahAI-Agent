// ==========================================
// FileTree — Safe Version
// ==========================================

import { useState, useEffect } from 'react';
import { Folder, File, ChevronRight, ChevronDown } from 'lucide-react';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface FileTreeProps {
  projectDir: string;
  onFileSelect?: (path: string) => void;
  selectedPath?: string;
}

export default function FileTree({ projectDir, onFileSelect, selectedPath }: FileTreeProps) {
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!projectDir) return;
    fetch(`http://localhost:3001/api/files?path=${encodeURIComponent(projectDir)}`)
      .then(res => res.json())
      .then(data => {
        // Xətanın qarşısını almaq üçün mütləq massiv olduğunu yoxlayırıq
        if (Array.isArray(data)) {
          setNodes(data);
        } else {
          console.error('Invalid data for FileTree:', data);
          setNodes([]);
        }
      })
      .catch(err => {
        console.error('Failed to fetch files:', err);
        setNodes([]);
      });
  }, [projectDir]);

  const toggle = (path: string) => {
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const renderNode = (node: FileNode) => {
    if (!node) return null;
    const isExpanded = expanded[node.path];
    const isSelected = selectedPath === node.path;

    return (
      <div key={node.path} className="select-none">
        <div 
          onClick={() => node.type === 'directory' ? toggle(node.path) : onFileSelect?.(node.path)}
          className={`flex items-center gap-1 px-2 py-1 cursor-pointer text-sm hover:bg-white/5 ${isSelected ? 'bg-blue-500/20 text-blue-400' : ''}`}
        >
          {node.type === 'directory' ? (
            <>
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Folder size={14} className="text-blue-400" />
            </>
          ) : (
            <>
              <div className="w-3.5" />
              <File size={14} className="text-gray-400" />
            </>
          )}
          <span className="truncate">{node.name}</span>
        </div>
        {node.type === 'directory' && isExpanded && node.children && (
          <div className="ml-4 border-l border-white/5">
            {Array.isArray(node.children) && node.children.map(child => renderNode(child))}
          </div>
        )}
      </div>
    );
  };

  if (!projectDir) return <div className="p-4 text-xs text-gray-500">Workspace seçilməyib</div>;

  return (
    <div className="flex-1 overflow-y-auto py-2">
      {Array.isArray(nodes) ? nodes.map(node => renderNode(node)) : null}
    </div>
  );
}

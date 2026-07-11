/**
 * bahAI - Composer + Attachment Tray
 * Adapted from LibreChat's input area.
 * Provides a UI logic pattern for adding/removing attachments before sending a message.
 */

import React, { useState, useRef } from 'react';
import { Paperclip, Send, X, FileText, Image as ImageIcon } from 'lucide-react';

interface Attachment {
  id: string;
  file: File;
  previewUrl?: string;
}

interface ComposerProps {
  onSendMessage: (text: string, attachments: File[]) => void;
  disabled?: boolean;
}

export function Composer({ onSendMessage, disabled }: ComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newAttachments = Array.from(e.target.files).map(file => ({
        id: Math.random().toString(36).substring(7),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
      }));
      setAttachments(prev => [...prev, ...newAttachments]);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(att => att.id !== id));
  };

  const handleSubmit = () => {
    if ((text.trim() || attachments.length > 0) && !disabled) {
      onSendMessage(text, attachments.map(a => a.file));
      setText('');
      setAttachments([]);
    }
  };

  return (
    <div className="flex flex-col w-full bg-gray-800 rounded-lg border border-gray-700 shadow-sm p-3 relative">
      {/* Attachment Tray */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 pb-3 border-b border-gray-700">
          {attachments.map(att => (
            <div key={att.id} className="relative flex items-center justify-center bg-gray-900 rounded-md p-1 border border-gray-600 h-16 w-16 group">
              {att.previewUrl ? (
                <img src={att.previewUrl} alt="preview" className="h-full w-full object-cover rounded" />
              ) : (
                <FileText size={24} className="text-gray-400" />
              )}
              <button
                onClick={() => removeAttachment(att.id)}
                className="absolute -top-2 -right-2 bg-gray-700 hover:bg-red-500 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={12} className="text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="flex items-end gap-2">
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-gray-400 hover:text-white transition-colors"
          disabled={disabled}
        >
          <Paperclip size={20} />
        </button>
        <input 
          type="file" 
          multiple 
          className="hidden" 
          ref={fileInputRef} 
          onChange={handleFileSelect}
        />
        
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Mesajınızı yazın..."
          className="flex-1 bg-transparent text-white outline-none resize-none max-h-32 py-2"
          rows={1}
          disabled={disabled}
        />

        <button 
          onClick={handleSubmit}
          disabled={disabled || (!text.trim() && attachments.length === 0)}
          className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-600 disabled:text-gray-400 text-white rounded-md transition-colors"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

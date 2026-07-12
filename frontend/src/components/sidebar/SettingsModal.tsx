import { useState, useMemo, useEffect } from 'react';
import { X, Code2, MonitorCog, Type, AlignLeft, Maximize, PanelRightClose, PanelBottom, Sun, Moon, Layout, Eye, Send, FileText, Brain, ArrowDownToLine, Zap, Key, Globe, LayoutTemplate, ShieldAlert, CircleOff, CheckCircle2, AlertTriangle, Workflow } from 'lucide-react';
import type { ReturnTypeUseSettings } from '../../hooks/useSettings';
import { MODELS, WORKFLOW_OPTIONS } from '../../lib/constants';
import { getDesktopRuntimeStatus, getGuiCapabilities, getInstalledBrowsers } from '../../lib/api';
import type { GuiCapabilityStatus } from '../../lib/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settingsCtx: ReturnTypeUseSettings;
  githubConnected?: boolean;
  githubUsername?: string | null;
  onConnectGithub?: (token: string) => Promise<void>;
  onDisconnectGithub?: () => Promise<void>;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-hover)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: '8px 12px',
  fontSize: '13px',
  outline: 'none',
  color: 'var(--fg-main)',
  transition: 'border-color 0.2s',
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 500,
  color: 'var(--fg-main)',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '6px',
};

const descStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--fg-muted)',
  marginTop: '4px',
};

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${checked ? 'bg-indigo-500' : 'bg-neutral-600'}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  );
}

export default function SettingsModal({ 
  isOpen, onClose, settingsCtx,
  githubConnected, githubUsername, onConnectGithub, onDisconnectGithub 
}: Props) {
  const [activeTab, setActiveTab] = useState<'general' | 'chat' | 'ai'>('general');
  const [githubTokenInput, setGithubTokenInput] = useState('');

  const {
    productMode, executionMode, setExecutionMode,
    model, setModel, performanceMode, setPerformanceMode,
    orchestrationMode, setOrchestrationMode, workflow, setWorkflow,
    customInstructions, setCustomInstructions,
    guiBrowserMode, setGuiBrowserMode, guiBrowserPath, setGuiBrowserPath,
    guiBrowserCdpUrl, setGuiBrowserCdpUrl, guiAutoStartBrowser, setGuiAutoStartBrowser,
    apiKey, setApiKey, baseUrl, setBaseUrl,
    language, setLanguage, messageFontSize, setMessageFontSize,
    chatDirection, setChatDirection, maximizeChatSpace, setMaximizeChatSpace,
    centerChatInput, setCenterChatInput, scrollToEndButton, setScrollToEndButton,
    keepScreenAwake, setKeepScreenAwake, enterToSend, setEnterToSend,
    enableMarkdown, setEnableMarkdown, showThinking, setShowThinking,
    autoScroll, setAutoScroll,
  } = settingsCtx;

  const [browsers, setBrowsers] = useState<Array<any>>([]);
  const [guiCapabilities, setGuiCapabilities] = useState<GuiCapabilityStatus | null>(null);

  if (!isOpen) return null;

  const isDesktopProduct = productMode === 'desktop_code';

  const renderGeneralTab = () => (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold mb-4 text-[var(--fg-main)]">Görünüş (Appearance)</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div style={labelStyle}><Sun size={14}/> Dil (Language)</div>
              <div style={descStyle}>İnterfeys dilini seçin.</div>
            </div>
            <select style={{ ...inputStyle, width: '180px' }} value={language} onChange={e => setLanguage(e.target.value)}>
              <option value="az">Azərbaycan (AZ)</option>
              <option value="en">English (EN)</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div style={labelStyle}><Type size={14}/> Şrift Ölçüsü (Message Font Size)</div>
              <div style={descStyle}>Mesajların mətn ölçüsü.</div>
            </div>
            <select style={{ ...inputStyle, width: '180px' }} value={messageFontSize} onChange={e => setMessageFontSize(e.target.value)}>
              <option value="small">Kiçik (Small)</option>
              <option value="medium">Orta (Medium)</option>
              <option value="large">Böyük (Large)</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div style={labelStyle}><AlignLeft size={14}/> Söhbət İstiqaməti (Chat Direction)</div>
              <div style={descStyle}>Soldan sağa və ya sağdan sola.</div>
            </div>
            <select style={{ ...inputStyle, width: '180px' }} value={chatDirection} onChange={e => setChatDirection(e.target.value as any)}>
              <option value="ltr">LTR (Soldan sağa)</option>
              <option value="rtl">RTL (Sağdan sola)</option>
            </select>
          </div>
        </div>
      </div>

      <hr className="border-[var(--border)]" />

      <div>
        <h3 className="text-sm font-semibold mb-4 text-[var(--fg-main)]">Layout (Görünüş Nümunəsi)</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div style={labelStyle}><Maximize size={14}/> Məkanı Maksimumlaşdır (Maximize chat space)</div>
              <div style={descStyle}>Söhbət pəncərəsini tam ekrana genişləndirir.</div>
            </div>
            <Switch checked={maximizeChatSpace} onChange={setMaximizeChatSpace} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div style={labelStyle}><PanelBottom size={14}/> Mərkəzi İnpüt (Center Chat Input)</div>
              <div style={descStyle}>Yeni söhbət zamanı yazmaq yerini mərkəzə alır.</div>
            </div>
            <Switch checked={centerChatInput} onChange={setCenterChatInput} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div style={labelStyle}><ArrowDownToLine size={14}/> Aşağı Sürüşdürmə Düyməsi (Scroll to End Button)</div>
              <div style={descStyle}>Ən yeni mesaja getmək üçün düymə göstərir.</div>
            </div>
            <Switch checked={scrollToEndButton} onChange={setScrollToEndButton} />
          </div>
        </div>
      </div>

      <hr className="border-[var(--border)]" />

      <div>
        <h3 className="text-sm font-semibold mb-4 text-[var(--fg-main)]">Əlçatanlıq (Accessibility)</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div style={labelStyle}><Eye size={14}/> Ekranı Oyaq Saxla (Keep screen awake)</div>
              <div style={descStyle}>Cavab generasiya olunarkən ekranın sönməsinə mane olur.</div>
            </div>
            <Switch checked={keepScreenAwake} onChange={setKeepScreenAwake} />
          </div>
        </div>
      </div>
      
      {!isDesktopProduct && onConnectGithub && (
        <>
          <hr className="border-[var(--border)]" />
          <div>
            <h3 className="text-sm font-semibold mb-4 text-[var(--fg-main)]">İnteqrasiyalar</h3>
            <div className="space-y-4">
              <div>
                <label style={labelStyle}>GitHub</label>
                {githubConnected ? (
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm" style={{ color: 'var(--color-success)' }}>@{githubUsername}</span>
                    <button 
                      onClick={() => onDisconnectGithub && onDisconnectGithub()}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg text-white bg-red-600 hover:bg-red-700 transition-colors"
                    >
                      Ayır
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2 mt-2">
                    <input
                      type="password"
                      value={githubTokenInput}
                      onChange={(e) => setGithubTokenInput(e.target.value)}
                      placeholder="ghp_..."
                      style={inputStyle}
                    />
                    <button 
                      onClick={async () => {
                        if (onConnectGithub) {
                          await onConnectGithub(githubTokenInput);
                          setGithubTokenInput('');
                        }
                      }}
                      className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 transition-colors whitespace-nowrap"
                    >
                      Bağla
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  const renderChatTab = () => (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold mb-4 text-[var(--fg-main)]">Mesajlaşma (Sending)</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div style={labelStyle}><Send size={14}/> Enter düyməsi ilə göndər (Enter to Send)</div>
              <div style={descStyle}>Sıradan Enter mesajı göndərir, Shift+Enter isə yeni sətirə keçir.</div>
            </div>
            <Switch checked={enterToSend} onChange={setEnterToSend} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div style={labelStyle}><FileText size={14}/> Markdown Formatı (Enable Markdown)</div>
              <div style={descStyle}>İstifadəçi mesajlarında kodu və qalın yazıları işıqlandırır.</div>
            </div>
            <Switch checked={enableMarkdown} onChange={setEnableMarkdown} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div style={labelStyle}><Brain size={14}/> Düşüncəni Göstər (Show Thinking)</div>
              <div style={descStyle}>Agentin qərarvermə prosesini (Thinking) mesajlarda göstərir.</div>
            </div>
            <Switch checked={showThinking} onChange={setShowThinking} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div style={labelStyle}><PanelRightClose size={14}/> Avtomatik Sürüşdür (Auto-Scroll)</div>
              <div style={descStyle}>Yeni mesajlar gəldikcə pəncərəni avtomatik aşağı endirir.</div>
            </div>
            <Switch checked={autoScroll} onChange={setAutoScroll} />
          </div>
        </div>
      </div>
    </div>
  );

  const renderAiTab = () => (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold mb-4 text-[var(--fg-main)]">Model & API</h3>
        <div className="space-y-4">
          {isDesktopProduct && (
            <div>
              <label style={labelStyle}><Zap size={14} /> Rejim (Execution Mode)</label>
              <select style={inputStyle} value={executionMode} onChange={(e) => setExecutionMode(e.target.value as 'cloud' | 'local')}>
                <option value="cloud">☁️ Bulud (Cloud / API)</option>
                <option value="local">💻 Lokal (Ollama / LMStudio)</option>
              </select>
            </div>
          )}
          <div>
            <label style={labelStyle}><Globe size={14} /> Base URL</label>
            <input style={inputStyle} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
          </div>
          <div>
            <label style={labelStyle}><Key size={14} /> API Key</label>
            <input style={inputStyle} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
          </div>
          <div>
            <label style={labelStyle}><Code2 size={14} /> Model</label>
            <select style={inputStyle} value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
              ))}
              {!MODELS.find(m => m.id === model) && <option value={model}>{model} (Custom)</option>}
            </select>
          </div>
          {isDesktopProduct && (
            <div>
              <label style={labelStyle}><Workflow size={14} /> İş Axını Növü (Workflow Mode)</label>
              <select style={inputStyle} value={workflow} onChange={(e) => setWorkflow(e.target.value)}>
                {WORKFLOW_OPTIONS.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      <hr className="border-[var(--border)]" />

      <div>
        <label style={labelStyle}><FileText size={14} /> Sistem Təlimatları (Custom Instructions)</label>
        <p style={descStyle} className="mb-2">Agentin necə cavab verməsini (qısa cavablar, konkret rol, vb.) tənzimləmək üçün təlimatlar yazın.</p>
        <textarea 
          style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} 
          value={customInstructions} 
          onChange={(e) => setCustomInstructions(e.target.value)}
          placeholder="Məsələn: Sən köməkçi bir proqramçısan. Həmişə azərbaycan dilində, qısa və anlaşıqlı kod parçaları ilə cavab ver."
        />
      </div>

      <hr className="border-[var(--border)]" />

      <div>
        <div className="flex items-center justify-between mb-2">
          <label style={labelStyle} className="mb-0"><Zap size={14} /> Yüksək Performans Rejimi (Performance Mode)</label>
          <Switch checked={performanceMode} onChange={setPerformanceMode} />
        </div>
        <p style={descStyle}>Animasiyaları ləğv edir, UI-ı daha sürətli edir (Zəif kompüterlər üçün).</p>
      </div>
      
      {isDesktopProduct && (
        <>
          <hr className="border-[var(--border)]" />
          <div>
            <div className="flex items-center justify-between mb-2">
              <label style={labelStyle} className="mb-0"><ShieldAlert size={14} /> Orkestrasyon Rejimi (Orchestration Mode)</label>
              <Switch checked={orchestrationMode} onChange={setOrchestrationMode} />
            </div>
            <p style={descStyle}>Mürəkkəb layihələr üçün sub-agentlər şəbəkəsi yaradır (Beta).</p>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center animate-fade-in px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative flex flex-col md:flex-row w-full max-w-4xl h-[85vh] bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden animate-slide-up">
        
        {/* Left Sidebar for Tabs */}
        <div className="w-full md:w-64 bg-[var(--bg-hover)] border-b md:border-b-0 md:border-r border-[var(--border)] flex flex-col shrink-0">
          <div className="p-4 md:p-6 pb-2 md:pb-6 flex items-center justify-between">
            <h2 className="text-xl font-bold text-[var(--fg-main)]">Tənzimləmələr</h2>
            <button onClick={onClose} className="md:hidden p-2 rounded-full hover:bg-[var(--bg-active)] text-[var(--fg-muted)] transition-colors">
              <X size={20} />
            </button>
          </div>
          
          <div className="flex md:flex-col overflow-x-auto md:overflow-x-hidden p-2 md:p-4 gap-1 flex-1">
            <button
              onClick={() => setActiveTab('general')}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left whitespace-nowrap ${activeTab === 'general' ? 'bg-indigo-500/10 text-indigo-500' : 'text-[var(--fg-muted)] hover:bg-[var(--bg-active)] hover:text-[var(--fg-main)]'}`}
            >
              <LayoutTemplate size={18} />
              Ümumi (General)
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left whitespace-nowrap ${activeTab === 'chat' ? 'bg-indigo-500/10 text-indigo-500' : 'text-[var(--fg-muted)] hover:bg-[var(--bg-active)] hover:text-[var(--fg-main)]'}`}
            >
              <Type size={18} />
              Söhbət (Chat)
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left whitespace-nowrap ${activeTab === 'ai' ? 'bg-indigo-500/10 text-indigo-500' : 'text-[var(--fg-muted)] hover:bg-[var(--bg-active)] hover:text-[var(--fg-main)]'}`}
            >
              <Brain size={18} />
              Süni İntellekt (AI Provider)
            </button>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col min-h-0 relative">
          <div className="hidden md:flex absolute top-4 right-4 z-10">
            <button onClick={onClose} className="p-2.5 rounded-full hover:bg-[var(--bg-hover)] bg-[var(--bg-surface)] text-[var(--fg-muted)] hover:text-[var(--fg-main)] transition-all border border-[var(--border)] shadow-sm">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
            {activeTab === 'general' && renderGeneralTab()}
            {activeTab === 'chat' && renderChatTab()}
            {activeTab === 'ai' && renderAiTab()}
          </div>
        </div>

      </div>
    </div>
  );
}

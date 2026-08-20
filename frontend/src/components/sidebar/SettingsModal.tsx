import { useState } from 'react';
import { X, Code2, Type, AlignLeft, Maximize, PanelRightClose, PanelBottom, Sun, Eye, Send, FileText, Brain, ArrowDownToLine, Zap, Key, Globe, LayoutTemplate, ShieldAlert, Workflow } from 'lucide-react';
import type { ReturnTypeUseSettings } from '../../hooks/useSettings';
import { MODELS, WORKFLOW_OPTIONS } from '../../lib/constants';

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
    apiKey, setApiKey, baseUrl, setBaseUrl,
    language, setLanguage, messageFontSize, setMessageFontSize,
    chatDirection, setChatDirection, maximizeChatSpace, setMaximizeChatSpace,
    centerChatInput, setCenterChatInput, scrollToEndButton, setScrollToEndButton,
    keepScreenAwake, setKeepScreenAwake, enterToSend, setEnterToSend,
    enableMarkdown, setEnableMarkdown, showThinking, setShowThinking,
    autoScroll, setAutoScroll,
    showModelBadge, setShowModelBadge,
    aiMode, setAiMode,
  } = settingsCtx;

  if (!isOpen) return null;

  const isDesktopProduct = productMode === 'desktop_code';

  const renderGeneralTab = () => (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold mb-4 text-[var(--fg-main)]">Görünüş</h3>
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div style={labelStyle}><Sun size={14}/> Dil</div>
              <div style={descStyle}>İnterfeys dilini seçin.</div>
            </div>
            <select style={{ ...inputStyle }} className="w-full sm:w-[180px]" value={language} onChange={e => setLanguage(e.target.value)}>
              <option value="az">Azərbaycan dili (AZ)</option>
              <option value="en">English (EN)</option>
            </select>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div style={labelStyle}><Type size={14}/> Şrift Ölçüsü</div>
              <div style={descStyle}>Mesajların mətn ölçüsü.</div>
            </div>
            <select style={{ ...inputStyle }} className="w-full sm:w-[180px]" value={messageFontSize} onChange={e => setMessageFontSize(e.target.value)}>
              <option value="small">Kiçik</option>
              <option value="medium">Orta</option>
              <option value="large">Böyük</option>
            </select>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div style={labelStyle}><AlignLeft size={14}/> Söhbət İstiqaməti</div>
              <div style={descStyle}>Mətnin düzülüş qaydası.</div>
            </div>
            <select style={{ ...inputStyle }} className="w-full sm:w-[180px]" value={chatDirection} onChange={e => setChatDirection(e.target.value as any)}>
              <option value="ltr">Soldan sağa (LTR)</option>
              <option value="rtl">Sağdan sola (RTL)</option>
            </select>
          </div>
        </div>
      </div>

      <hr className="border-[var(--border)]" />

      <div>
        <h3 className="text-sm font-semibold mb-4 text-[var(--fg-main)]">Ekran Layoutu</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div style={labelStyle}><Maximize size={14}/> Məkanı Genişləndir</div>
              <div style={descStyle}>Söhbət pəncərəsini tam ekrana yayır.</div>
            </div>
            <Switch checked={maximizeChatSpace} onChange={setMaximizeChatSpace} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div style={labelStyle}><PanelBottom size={14}/> Mərkəzi Giriş Paneli</div>
              <div style={descStyle}>Yazmaq yerini ekranın mərkəzində saxlayır.</div>
            </div>
            <Switch checked={centerChatInput} onChange={setCenterChatInput} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div style={labelStyle}><ArrowDownToLine size={14}/> Aşağı Enmə Düyməsi</div>
              <div style={descStyle}>Ən yeni mesaja getmək üçün cəld düymə.</div>
            </div>
            <Switch checked={scrollToEndButton} onChange={setScrollToEndButton} />
          </div>
        </div>
      </div>

      <hr className="border-[var(--border)]" />

      <div>
        <h3 className="text-sm font-semibold mb-4 text-[var(--fg-main)]">Əlçatanlıq</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div style={labelStyle}><Eye size={14}/> Ekranı Oyaq Saxla</div>
              <div style={descStyle}>Cavab yazılarkən ekranın sönməsinə mane olur.</div>
            </div>
            <Switch checked={keepScreenAwake} onChange={setKeepScreenAwake} />
          </div>
        </div>
      </div>
      
      {isDesktopProduct && onConnectGithub && (
        <>
          <hr className="border-[var(--border)]" />
          <div>
            <h3 className="text-sm font-semibold mb-4 text-[var(--fg-main)]">İnteqrasiyalar</h3>
            <div className="space-y-4">
              <div>
                <label style={labelStyle}>GitHub Hesabı</label>
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
        <h3 className="text-sm font-semibold mb-4 text-[var(--fg-main)]">Mesaj Göndərmə</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div style={labelStyle}><Send size={14}/> Enter Düyməsi ilə Göndər</div>
              <div style={descStyle}>Enter mesajı göndərir, Shift+Enter yeni sətirə keçir.</div>
            </div>
            <Switch checked={enterToSend} onChange={setEnterToSend} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div style={labelStyle}><FileText size={14}/> Markdown Formatı</div>
              <div style={descStyle}>Kodu və qalın yazıları təmiz formatda göstərir.</div>
            </div>
            <Switch checked={enableMarkdown} onChange={setEnableMarkdown} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div style={labelStyle}><Brain size={14}/> Düşüncə Addımlarını Göstər</div>
              <div style={descStyle}>Agentin daxili təhlil addımlarını göstərir.</div>
            </div>
            <Switch checked={showThinking} onChange={setShowThinking} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div style={labelStyle}><PanelRightClose size={14}/> Avtomatik Sürüşdürmə</div>
              <div style={descStyle}>Yeni cavab gəldikcə pəncərəni aşağı endirir.</div>
            </div>
            <Switch checked={autoScroll} onChange={setAutoScroll} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div style={labelStyle}><Zap size={14}/> Model Mənbəyini Göstər (Debug)</div>
              <div style={descStyle}>Hər bir cavabın hansı provider və ya modeldən gəldiyini göstərir.</div>
            </div>
            <Switch checked={showModelBadge} onChange={setShowModelBadge} />
          </div>
        </div>
      </div>
    </div>
  );

  const renderAiTab = () => (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold mb-4 text-[var(--fg-main)]">AI Rejimi (AI Mode)</h3>

        {!isDesktopProduct ? (
          <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-hover)]">
            <div className="flex items-center gap-2 mb-1">
              <Brain size={16} />
              <span className="font-semibold text-sm">BahAI Smart</span>
            </div>
            <p className="text-xs text-[var(--fg-secondary)]">
              Web versiyada provider və model seçimini BahAI arxa planda avtomatik idarə edir.
              Manual model seçimi desktop tətbiqində mövcuddur.
            </p>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <label
              className={`flex-1 flex flex-col p-3 rounded-lg border cursor-pointer transition-colors ${aiMode === 'smart' ? 'bg-[var(--bg-accent)] border-blue-500/50' : 'bg-[var(--bg-surface-elevated)] border-[var(--border)]'}`}
              onClick={() => setAiMode('smart')}
            >
              <div className="flex items-center gap-2 mb-1">
                <input type="radio" checked={aiMode === 'smart'} readOnly className="accent-blue-500" />
                <span className="font-semibold text-sm">✨ BahAI Smart</span>
              </div>
              <span className="text-xs text-[var(--fg-secondary)] ml-5">Avtomatik model və provider seçimi.</span>
            </label>

            <label
              className={`flex-1 flex flex-col p-3 rounded-lg border cursor-pointer transition-colors ${aiMode === 'manual' ? 'bg-[var(--bg-accent)] border-blue-500/50' : 'bg-[var(--bg-surface-elevated)] border-[var(--border)]'}`}
              onClick={() => setAiMode('manual')}
            >
              <div className="flex items-center gap-2 mb-1">
                <input type="radio" checked={aiMode === 'manual'} readOnly className="accent-blue-500" />
                <span className="font-semibold text-sm">⚙️ Manual (Pro)</span>
              </div>
              <span className="text-xs text-[var(--fg-secondary)] ml-5">Öz API açarınızı, provider-i və modeli istifadə edin.</span>
            </label>
          </div>
        )}

        {isDesktopProduct && aiMode === 'manual' && (
          <div className="space-y-4 bg-[var(--bg-surface-elevated)] p-4 rounded-lg border border-[var(--border)]">
            {isDesktopProduct && (
              <div>
                <label style={labelStyle}><Zap size={14} /> Rejim (Execution Mode)</label>
                <select aria-label="Execution mode" style={inputStyle} value={executionMode} onChange={(e) => setExecutionMode(e.target.value as 'cloud' | 'local')}>
                  <option value="cloud">☁️ Bulud (Cloud / API)</option>
                  <option value="local">💻 Lokal (Ollama / LMStudio)</option>
                </select>
              </div>
            )}
            <div>
              <label style={labelStyle}><Globe size={14} /> Base URL</label>
              <input aria-label="Provider base URL" style={inputStyle} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
            </div>
            <div>
              <label style={labelStyle}><Key size={14} /> API Key</label>
              <input aria-label="Provider API key" style={inputStyle} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
            </div>
            <div>
              <label style={labelStyle}><Code2 size={14} /> Model</label>
              <select aria-label="AI model" style={inputStyle} value={model} onChange={(e) => setModel(e.target.value)}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
                ))}
                {!MODELS.find(m => m.id === model) && <option value={model}>{model} (Custom)</option>}
              </select>
            </div>
          </div>
        )}
        {isDesktopProduct && (
          <div>
            <label style={labelStyle}><Workflow size={14} /> İş Axını Növü (Workflow Mode)</label>
            <select style={inputStyle} value={workflow} onChange={(e) => setWorkflow(e.target.value)}>
              {WORKFLOW_OPTIONS.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        )}
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

          <hr className="border-[var(--border)]" />
          <div>
            <div className="flex items-center justify-between mb-2">
              <label style={labelStyle} className="mb-0"><Zap size={14} /> 🧪 DSH 100-Prompt Stress & Audit Test</label>
              <button
                onClick={async () => {
                  try {
                    const token = localStorage.getItem('bahai_auth_token');
                    const res = await fetch('/api/dsh/stress-test', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {})
                      }
                    });
                    const data = await res.json();
                    alert(data.message || '100+ Stress Test Başladıldı!');
                  } catch (err) {
                    alert('Xəta yarandı: ' + err.message);
                  }
                }}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold transition-colors"
              >
                Testi Başlat 🚀
              </button>
            </div>
            <p style={descStyle}>Agenti 100 ağır alqoritmik, riyazi və veb tətbiq sorğusu ilə fonda sınaqdan keçirir.</p>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center animate-fade-in p-0 sm:px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative flex flex-col md:flex-row w-full max-w-4xl h-[92dvh] sm:h-[85vh] bg-[var(--bg-surface)] border-t sm:border border-[var(--border)] rounded-t-2xl sm:rounded-xl shadow-2xl overflow-hidden animate-slide-up">
        
        {/* Left Sidebar / Mobile Top Nav for Tabs */}
        <div className="w-full md:w-64 bg-[var(--bg-hover)] border-b md:border-b-0 md:border-r border-[var(--border)] flex flex-col shrink-0">
          <div className="p-3 sm:p-5 flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-bold text-[var(--fg-main)]">Tənzimləmələr</h2>
            <button aria-label="Parametrləri bağla" onClick={onClose} className="md:hidden p-2 rounded-full hover:bg-[var(--bg-active)] text-[var(--fg-muted)] transition-colors active:scale-95">
              <X size={20} />
            </button>
          </div>
          
          <div className="flex md:flex-col overflow-x-auto md:overflow-x-hidden px-3 py-2 md:p-4 gap-1.5 flex-1 no-scrollbar">
            <button
              onClick={() => setActiveTab('general')}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap shrink-0 md:shrink ${activeTab === 'general' ? 'bg-indigo-500/15 text-indigo-400 font-semibold' : 'text-[var(--fg-muted)] hover:bg-[var(--bg-active)] hover:text-[var(--fg-main)]'}`}
            >
              <LayoutTemplate size={16} />
              Ümumi
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap shrink-0 md:shrink ${activeTab === 'chat' ? 'bg-indigo-500/15 text-indigo-400 font-semibold' : 'text-[var(--fg-muted)] hover:bg-[var(--bg-active)] hover:text-[var(--fg-main)]'}`}
            >
              <Type size={16} />
              Söhbət
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap shrink-0 md:shrink ${activeTab === 'ai' ? 'bg-indigo-500/15 text-indigo-400 font-semibold' : 'text-[var(--fg-muted)] hover:bg-[var(--bg-active)] hover:text-[var(--fg-main)]'}`}
            >
              <Brain size={16} />
              Süni İntellekt
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-h-0 relative">
          <div className="hidden md:flex absolute top-4 right-4 z-10">
            <button aria-label="Parametrləri bağla" onClick={onClose} className="p-2 rounded-full hover:bg-[var(--bg-hover)] bg-[var(--bg-surface)] text-[var(--fg-muted)] hover:text-[var(--fg-main)] transition-all border border-[var(--border)] shadow-sm">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 custom-scrollbar">
            {activeTab === 'general' && renderGeneralTab()}
            {activeTab === 'chat' && renderChatTab()}
            {activeTab === 'ai' && renderAiTab()}
          </div>
        </div>

      </div>
    </div>
  );
}

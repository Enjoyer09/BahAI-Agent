import { useEffect, useMemo, useState } from 'react';
import { Code2, Zap, Search, Globe, Key, ShieldAlert, Workflow, MonitorCog, CheckCircle2, AlertTriangle, CircleOff } from 'lucide-react';
import { MODELS, WORKFLOW_OPTIONS } from '../../lib/constants';
import { getDesktopRuntimeStatus, getGuiCapabilities, getInstalledBrowsers } from '../../lib/api';
import type { GuiCapabilityStatus } from '../../lib/types';
import type { ReturnTypeUseSettings } from '../../hooks/useSettings';
import { Button } from '../common/UI';

// Static style objects — defined once outside the component to avoid recreation on every render
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
  fontSize: '11px',
  fontWeight: 500,
  color: 'var(--fg-muted)',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  marginBottom: '4px',
};

interface Props {
  settingsCtx: ReturnTypeUseSettings;
}

export default function SettingsPanel({ settingsCtx }: Props) {
  const { 
    productMode,
    executionMode, setExecutionMode,
    model, setModel, 
    performanceMode, setPerformanceMode,
    orchestrationMode, setOrchestrationMode,
    workflow, setWorkflow,
    guiBrowserMode, setGuiBrowserMode,
    guiBrowserPath, setGuiBrowserPath,
    guiBrowserCdpUrl, setGuiBrowserCdpUrl,
    guiAutoStartBrowser, setGuiAutoStartBrowser,
    apiKey, setApiKey,
    baseUrl, setBaseUrl
  } = settingsCtx;
  
  const [query, setQuery] = useState('');
  const [browsers, setBrowsers] = useState<Array<{ id: string; name: string; path: string; installed: boolean; supportsCdp: boolean; recommended?: boolean }>>([]);
  const [browserScanError, setBrowserScanError] = useState('');
  const [guiCapabilities, setGuiCapabilities] = useState<GuiCapabilityStatus | null>(null);
  const [guiCapabilityError, setGuiCapabilityError] = useState('');
  const [desktopRuntime, setDesktopRuntime] = useState<{
    mode: string;
    baseUrl: string;
    model: string;
    ready: boolean;
    status: 'ok' | 'degraded' | 'missing' | 'unknown';
    summary: string;
    checks: Array<{ key: string; ok: boolean; detail: string }>;
  } | null>(null);
  const [desktopRuntimeError, setDesktopRuntimeError] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(() => {
    return baseUrl && !baseUrl.includes('openrouter.ai');
  });

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MODELS;
    return MODELS.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
    );
  }, [query]);

  const freemodelOptions = useMemo(
    () => MODELS.filter((m) => m.provider === 'FreeModel'),
    []
  );
  const freebuffOptions = useMemo(
    () => MODELS.filter((m) => m.provider === 'Freebuff'),
    []
  );
  const isFreemodelBase = /api\.freemodel\.dev/i.test(baseUrl);
  const isFreebuffBase = /localhost:8080|127\.0\.0\.1:8080|freebuff/i.test(baseUrl);

  const selected = MODELS.find(m => m.id === model);
  const activeWorkflow = WORKFLOW_OPTIONS.find((item) => item.id === workflow);
  const isDesktopProduct = productMode === 'desktop_code';
  const isWebProduct = productMode === 'web_chat';
  const showDesktopControls = isDesktopProduct;

  useEffect(() => {
    let cancelled = false;
    const loadGuiCapabilities = async () => {
      try {
        setGuiCapabilityError('');
        const status = await getGuiCapabilities({
          mode: guiBrowserMode,
          browserPath: guiBrowserPath,
          cdpUrl: guiBrowserCdpUrl
        });
        if (!cancelled) {
          setGuiCapabilities(status);
        }
      } catch (error: any) {
        if (!cancelled) {
          setGuiCapabilityError(error?.message || 'GUI capability status alınmadı');
        }
      }
    };
    loadGuiCapabilities();
    return () => {
      cancelled = true;
    };
  }, [guiBrowserMode, guiBrowserPath, guiBrowserCdpUrl]);

  useEffect(() => {
    if (!isDesktopProduct) return;
    let cancelled = false;
    const loadDesktopRuntime = async () => {
      try {
        setDesktopRuntimeError('');
        const runtime = await getDesktopRuntimeStatus({
          mode: executionMode,
          baseUrl,
          model
        });
        if (!cancelled) setDesktopRuntime(runtime);
      } catch (error: any) {
        if (!cancelled) setDesktopRuntimeError(error?.message || 'Desktop runtime status alınmadı');
      }
    };
    loadDesktopRuntime();
    return () => {
      cancelled = true;
    };
  }, [isDesktopProduct, executionMode, baseUrl, model]);

  const scanBrowsers = async () => {
    setBrowserScanError('');
    try {
      const result = await getInstalledBrowsers();
      setBrowsers(result.browsers || []);
      const recommended = result.browsers?.find((item) => item.installed && item.recommended) || result.browsers?.find((item) => item.installed);
      if (recommended && !guiBrowserPath) {
        setGuiBrowserPath(recommended.path);
      }
      if (result.recommendedMode && !guiBrowserMode) {
        setGuiBrowserMode(result.recommendedMode);
      }
      if (result.cdpUrl && !guiBrowserCdpUrl) {
        setGuiBrowserCdpUrl(result.cdpUrl);
      }
    } catch (error: any) {
      setBrowserScanError(error?.message || 'Browser scan alınmadı');
    }
  };

  const statusTone = guiCapabilities?.summary.status || 'missing';
  const statusMeta = statusTone === 'ok'
    ? { icon: CheckCircle2, color: 'var(--color-success, #22c55e)', label: 'Hazır' }
    : statusTone === 'degraded'
      ? { icon: AlertTriangle, color: 'var(--color-warning, #f59e0b)', label: 'Degraded' }
      : { icon: CircleOff, color: 'var(--fg-muted)', label: 'Missing' };
  const StatusIcon = statusMeta.icon;
  const installedBrowserCount = guiCapabilities?.browser.installedBrowsers.filter((item) => item.installed).length || 0;
  const showLocalRuntimeGuidance = isDesktopProduct && executionMode === 'local' && !!desktopRuntime && !desktopRuntime.ready;
  const showCloudRuntimeGuidance = isDesktopProduct && executionMode === 'cloud' && !!desktopRuntime && !apiKey;

  const handlePreset = (type: 'ollama' | 'lmstudio' | 'openrouter' | 'freemodel' | 'freebuff') => {
    if (type === 'ollama') {
      setBaseUrl('http://localhost:11434/v1');
      setApiKey('ollama');
      setModel('gemma4:12b');
      setIsCustomMode(true);
    } else if (type === 'lmstudio') {
      setBaseUrl('http://localhost:1234/v1');
      setApiKey('lm-studio');
      setModel('gemma4:12b');
      setIsCustomMode(true);
    } else if (type === 'freemodel') {
      setBaseUrl('https://api.freemodel.dev/v1');
      setApiKey('');
      setModel('gpt-5.5');
      setIsCustomMode(true);
    } else if (type === 'freebuff') {
      setBaseUrl('http://localhost:8080/v1');
      setApiKey('');
      setModel('deepseek-v4-flash');
      setIsCustomMode(true);
    } else {
      setBaseUrl('https://openrouter.ai/api/v1');
      setApiKey('');
      setModel('qwen/qwen3-coder:free');
      setIsCustomMode(false);
    }
  };



  if (isWebProduct) {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <button
            onClick={() => setPerformanceMode(!performanceMode)}
            className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors"
            style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
            role="switch"
            aria-checked={performanceMode}
          >
            <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--fg-main)' }}>
              <Zap size={14} style={{ color: performanceMode ? 'var(--color-accent)' : 'var(--fg-muted)' }} />
              Performans Rejimi
            </div>
            <div
              className="w-9 h-5 rounded-full relative transition-colors"
              style={{ background: performanceMode ? 'var(--color-accent)' : 'var(--fg-faint)' }}
            >
              <div
                className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                style={{
                  background: 'white',
                  left: performanceMode ? '18px' : '2px',
                }}
              />
            </div>
          </button>
          <p className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
            Animasiyaları və arxa fon bulanıqlığını azaldaraq web təcrübəsini yüngülləşdirir.
          </p>
        </div>
      </div>
    );
  }

  if (isWebProduct) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
        <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--fg-main)' }}>
          Aktiv konfiqurasiya
        </div>
        <div className="text-[11px] space-y-1" style={{ color: 'var(--fg-secondary)' }}>
          <div>Məhsul: <span style={{ color: 'var(--fg-main)' }}>BahAI Desktop</span></div>
          <div>Rejim: <span style={{ color: 'var(--fg-main)' }}>{executionMode === 'local' ? 'Local' : 'Cloud'}</span></div>
          <div>Model: <span style={{ color: 'var(--fg-main)' }}>{selected?.name || model}</span></div>
          <div>Workflow: <span style={{ color: 'var(--fg-main)' }}>{orchestrationMode ? (activeWorkflow?.name || workflow) : 'Söndürülüb'}</span></div>
          <div>Browser: <span style={{ color: 'var(--fg-main)' }}>{guiBrowserMode}</span></div>
          <div>Endpoint: <span style={{ color: 'var(--fg-main)' }}>{baseUrl}</span></div>
        </div>
      </div>

      {isDesktopProduct && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
          <div className="text-[11px] font-semibold" style={{ color: 'var(--fg-main)' }}>
            Execution Source
          </div>
          <div className="flex rounded-lg p-0.5 bg-[var(--bg-main)] border border-[var(--border)]">
            <button
              onClick={() => setExecutionMode('cloud')}
              className="flex-1 py-1.5 text-[11px] font-medium rounded-md transition-all"
              style={{
                background: executionMode === 'cloud' ? 'var(--bg-hover)' : 'transparent',
                color: executionMode === 'cloud' ? 'var(--fg-main)' : 'var(--fg-muted)'
              }}
            >
              Cloud
            </button>
            <button
              onClick={() => setExecutionMode('local')}
              className="flex-1 py-1.5 text-[11px] font-medium rounded-md transition-all"
              style={{
                background: executionMode === 'local' ? 'var(--bg-hover)' : 'transparent',
                color: executionMode === 'local' ? 'var(--fg-main)' : 'var(--fg-muted)'
              }}
            >
              Local
            </button>
          </div>
          <div className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
            Model seçimi gizlidir. BahAI seçilən mənbəyə görə ən uyğun modeli özü seçir.
          </div>
          <div className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-main)', border: '1px solid var(--border)' }}>
            <div className="text-[10px] font-semibold mb-1" style={{ color: 'var(--fg-main)' }}>
              {executionMode === 'local' ? 'Local Desktop aktivdir' : 'Cloud Desktop aktivdir'}
            </div>
            <div className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
              {executionMode === 'local'
                ? 'Bu rejim lokal model, fayl sistemi və terminal axınlarına üstünlük verir. Gecikmə az, nəzarət yüksəkdir.'
                : 'Bu rejim cloud provider qatına üstünlük verir. Daha güclü reasoning və geniş model routing istifadə olunur.'}
            </div>
          </div>
          {executionMode === 'local' && (
            <div className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
              Local rejimdə desktop routing əsasən Ollama / lokal modellər üzərindən işləyir.
            </div>
          )}
        </div>
      )}

      {showLocalRuntimeGuidance && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
          <div className="text-[11px] font-semibold" style={{ color: 'var(--fg-main)' }}>
            Local Fix Guidance
          </div>
          <div className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
            Local runtime hazır deyilsə adətən iki addım kifayətdir: əvvəl server-i qaldır, sonra modeli yüklə.
          </div>
          <div className="space-y-1.5">
            <div className="rounded-md px-2.5 py-2 font-mono text-[10px]" style={{ background: 'var(--bg-main)', border: '1px solid var(--border)', color: 'var(--fg-main)' }}>
              ollama serve
            </div>
            <div className="rounded-md px-2.5 py-2 font-mono text-[10px]" style={{ background: 'var(--bg-main)', border: '1px solid var(--border)', color: 'var(--fg-main)' }}>
              ollama pull gemma4:12b
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={() => {
                setBaseUrl('http://localhost:11434/v1');
                setApiKey('ollama');
                setModel('gemma4:12b');
              }}
            >
              Ollama preset et
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setExecutionMode('cloud');
                setBaseUrl('https://api.freemodel.dev/v1');
                setApiKey('');
                setModel('gpt-5.5');
              }}
            >
              Cloud-a keç
            </Button>
          </div>
        </div>
      )}

      {showCloudRuntimeGuidance && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
          <div className="text-[11px] font-semibold" style={{ color: 'var(--fg-main)' }}>
            Cloud Fix Guidance
          </div>
          <div className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
            Cloud rejimdə ən rahat başlanğıc üçün FreeModel API key daxil edin. İstəsəniz bir kliklə local rejimə də keçə bilərsiniz.
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={() => handlePreset('freemodel')}
            >
              FreeModel preset et
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExecutionMode('local')}
            >
              Local-a keç
            </Button>
          </div>
        </div>
      )}

      {isDesktopProduct && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold" style={{ color: 'var(--fg-main)' }}>
              Desktop Runtime Status
            </div>
            <div className="text-[10px]" style={{ color: desktopRuntime?.ready ? 'var(--color-success, #22c55e)' : 'var(--fg-muted)' }}>
              {desktopRuntime?.ready ? 'Hazır' : (desktopRuntime?.status === 'missing' ? 'Hazır deyil' : 'Yoxlanır')}
            </div>
          </div>
          {desktopRuntimeError ? (
            <div className="text-[10px]" style={{ color: 'var(--color-warning, #f59e0b)' }}>
              {desktopRuntimeError}
            </div>
          ) : desktopRuntime ? (
            <>
              <div className="text-[10px]" style={{ color: 'var(--fg-secondary)' }}>
                {desktopRuntime.summary}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {desktopRuntime.checks.map((check) => (
                  <span
                    key={`${check.key}-${check.detail}`}
                    className="px-2 py-1 rounded-md text-[10px] font-mono"
                    style={{
                      background: 'var(--bg-main)',
                      color: check.ok ? 'var(--color-success, #22c55e)' : 'var(--fg-muted)',
                      border: '1px solid var(--border)'
                    }}
                  >
                    {check.key}: {check.detail}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
              Yoxlanır...
            </div>
          )}
        </div>
      )}

      {showDesktopControls && (
      <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <MonitorCog size={14} style={{ color: 'var(--fg-muted)' }} />
            <span className="text-[11px] font-semibold" style={{ color: 'var(--fg-main)' }}>
              GUI Capability Status
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]" style={{ color: statusMeta.color }}>
            <StatusIcon size={12} />
            <span>{statusMeta.label}</span>
          </div>
        </div>

        {guiCapabilityError ? (
          <div className="text-[11px]" style={{ color: 'var(--color-warning, #f59e0b)' }}>
            {guiCapabilityError}
          </div>
        ) : guiCapabilities ? (
          <>
            <div className="text-[11px] space-y-1" style={{ color: 'var(--fg-secondary)' }}>
              <div>Platforma: <span style={{ color: 'var(--fg-main)' }}>{guiCapabilities.runtime.platform}</span></div>
              <div>Browser mode: <span style={{ color: 'var(--fg-main)' }}>{guiCapabilities.browser.resolvedMode}</span></div>
              <div>Playwright: <span style={{ color: 'var(--fg-main)' }}>{guiCapabilities.browser.playwrightInstalled ? 'ok' : 'missing'}</span></div>
              <div>Screen agent: <span style={{ color: 'var(--fg-main)' }}>{guiCapabilities.screenAgent.available ? 'ok' : 'missing'}</span></div>
              <div>Computer Use: <span style={{ color: 'var(--fg-main)' }}>{guiCapabilities.computerUse.available ? 'ok' : 'missing'}</span></div>
              <div>Tapılan browser: <span style={{ color: 'var(--fg-main)' }}>{installedBrowserCount}</span></div>
            </div>

            {!!guiCapabilities.warnings.length && (
              <div className="flex flex-wrap gap-1.5">
                {guiCapabilities.warnings.slice(0, 6).map((warning, idx) => (
                  <span
                    key={`${warning}-${idx}`}
                    className="px-2 py-1 rounded-md text-[10px] font-mono"
                    style={{ background: 'var(--bg-main)', color: 'var(--fg-muted)', border: '1px solid var(--border)' }}
                  >
                    {warning}
                  </span>
                ))}
              </div>
            )}

            <div className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
              Tövsiyə: {guiCapabilities.summary.recommendedWorkflow} workflow, {guiCapabilities.summary.recommendedBrowserMode} browser mode
            </div>
            {guiCapabilities.computerUse.appPath && (
              <div className="text-[10px] font-mono truncate" style={{ color: 'var(--fg-muted)' }}>
                {guiCapabilities.computerUse.appPath}
              </div>
            )}
          </>
        ) : (
          <div className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
            GUI status yüklənir...
          </div>
        )}
      </div>
      )}

      {/* Provider Selector Tab */}
      {showDesktopControls && (
      <>
      <div className="flex rounded-lg p-0.5 bg-[var(--bg-hover)] border border-[var(--border)]">
        <button
          onClick={() => {
            setIsCustomMode(false);
            handlePreset('openrouter');
          }}
          className="flex-1 py-1 text-[11px] font-medium rounded-md transition-all"
          style={{
            background: !isCustomMode ? 'var(--bg-main)' : 'transparent',
            color: !isCustomMode ? 'var(--fg-main)' : 'var(--fg-muted)',
            boxShadow: !isCustomMode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          }}
        >
          Bulud (bahAI)
        </button>
        <button
          onClick={() => {
            setIsCustomMode(true);
            setBaseUrl('http://localhost:11434/v1');
            setApiKey('ollama');
            setModel('gemma4:12b');
          }}
          className="flex-1 py-1 text-[11px] font-medium rounded-md transition-all"
          style={{
            background: isCustomMode ? 'var(--bg-main)' : 'transparent',
            color: isCustomMode ? 'var(--fg-main)' : 'var(--fg-muted)',
            boxShadow: isCustomMode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          }}
        >
          Lokal / Xüsusi LLM
        </button>
      </div>

      {!isCustomMode ? (
        <div className="space-y-4">
          {/* API Key — always visible for cloud mode */}
          <div className="space-y-1">
            <label style={labelStyle}>
              <Key size={12} /> API Açarı (FreeModel / OpenRouter)
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="FreeModel API key daxil edin"
              style={inputStyle}
            />
            {!apiKey && (
              <p className="text-[10px] mt-1" style={{ color: 'var(--color-warning, #f59e0b)' }}>
                ⚠️ API key daxil edin. <a href="https://freemodel.dev" target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}>freemodel.dev</a>-dən pulsuz key alın.
              </p>
            )}
            {apiKey && (
              <p className="text-[10px] mt-1" style={{ color: 'var(--color-success, #22c55e)' }}>
                ✅ API key qeyd olunub
              </p>
            )}
          </div>

          {/* Model selection */}
          <div className="space-y-2">
            <label style={labelStyle}>
              <Code2 size={12} /> Model Seçin
            </label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--fg-muted)' }} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Model axtar..."
                style={{ ...inputStyle, paddingLeft: '32px' }}
              />
            </div>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {filteredModels.map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
              ))}
            </select>
            <div className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
              Aktiv: <span style={{ color: 'var(--fg-main)' }}>{selected?.name || model}</span>
            </div>
          </div>

          {/* Base URL (hidden but configurable) */}
          <div className="space-y-1">
            <label style={labelStyle}>
              <Globe size={12} /> API Endpoint
            </label>
            <select
              value={baseUrl.includes('freemodel') ? 'freemodel' : baseUrl.includes('openrouter') ? 'openrouter' : 'custom'}
              onChange={e => {
                if (e.target.value === 'freemodel') setBaseUrl('https://api.freemodel.dev/v1');
                else if (e.target.value === 'openrouter') setBaseUrl('https://openrouter.ai/api/v1');
              }}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="freemodel">FreeModel.dev (Pulsuz GPT-5.5)</option>
              <option value="openrouter">OpenRouter (Ödənişli)</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="space-y-4 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-hover)] bg-opacity-30">
          <div className="flex items-center justify-between">
            <span style={labelStyle}>⚡ Cəld Şablonlar:</span>
            <div className="flex gap-1.5">
              <button
                onClick={() => handlePreset('freemodel')}
                className="text-[10px] px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--bg-main)] hover:bg-[var(--bg-hover)] text-[var(--fg-main)] font-semibold transition-all"
              >
                FreeModel
              </button>
              <button
                onClick={() => handlePreset('freebuff')}
                className="text-[10px] px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--bg-main)] hover:bg-[var(--bg-hover)] text-[var(--fg-main)] font-semibold transition-all"
              >
                Freebuff
              </button>
              <button
                onClick={() => handlePreset('ollama')}
                className="text-[10px] px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--bg-main)] hover:bg-[var(--bg-hover)] text-[var(--fg-main)] font-semibold transition-all"
              >
                Ollama
              </button>
              <button
                onClick={() => handlePreset('lmstudio')}
                className="text-[10px] px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--bg-main)] hover:bg-[var(--bg-hover)] text-[var(--fg-main)] font-semibold transition-all"
              >
                LM Studio
              </button>
            </div>
          </div>

          {/* Base URL */}
          <div className="space-y-1">
            <label style={labelStyle}>
              <Globe size={12} /> API Endpoint (Base URL)
            </label>
            <input
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              style={inputStyle}
            />
          </div>

          {/* API Key */}
          <div className="space-y-1">
            <label style={labelStyle}>
              <Key size={12} /> API Key (Açar)
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="API açarını daxil edin"
              style={inputStyle}
            />
          </div>
          {/* Custom Model ID */}
          <div className="space-y-1">
            <label style={labelStyle}>
              <Code2 size={12} /> Model ID
            </label>
            <input
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="qwen2.5-coder:latest"
              style={inputStyle}
            />
          </div>

          {isFreemodelBase && (
            <div className="space-y-1">
              <label style={labelStyle}>
                <Code2 size={12} /> FreeModel Modelləri
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                {freemodelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isFreebuffBase && (
            <div className="space-y-1">
              <label style={labelStyle}>
                <Code2 size={12} /> Freebuff Modelləri
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                {freebuffOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <div className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
                Freebuff2API proxy üçün tipik endpoint: `http://localhost:8080/v1`
              </div>
              <div className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
                Siyahıda olmayan model varsa yuxarıdakı `Model ID` sahəsinə birbaşa yazmaq olar.
              </div>
            </div>
          )}

          <div className="flex gap-2 items-start p-2 rounded bg-[var(--bg-main)] border border-[var(--border)] text-[10px]" style={{ color: 'var(--fg-muted)' }}>
            <ShieldAlert size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <span>
              Xüsusi provider üçün endpoint, model ID və API key uyğun olmalıdır. Lokal istifadə üçün <strong>Ollama</strong> və ya <strong>LM Studio</strong>-nun aktiv olduğundan əmin olun.
            </span>
          </div>

          {isFreemodelBase && (
            <div className="flex gap-2 items-start p-2 rounded bg-[var(--bg-main)] border border-[var(--border)] text-[10px]" style={{ color: 'var(--fg-muted)' }}>
              <ShieldAlert size={16} className="text-sky-500 flex-shrink-0 mt-0.5" />
              <span>
                <strong>FreeModel</strong> üçün endpoint <strong>https://api.freemodel.dev/v1</strong> olmalıdır. Bu provider bahAI daxilində <strong>chat-completions</strong> kimi işlədilir.
              </span>
            </div>
          )}
        </div>
      )}
      </>
      )}

      {showDesktopControls && (
      <>
      <div className="rounded-lg p-3 space-y-1.5" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
        <div className="text-[11px] font-semibold" style={{ color: 'var(--fg-main)' }}>
          Desktop Onboarding
        </div>
        <div className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
          Ən rahat başlanğıc axını: əvvəl `Execution Source` seç, sonra layihə qovluğunu aç, daha sonra agentə audit, fix və ya feature tapşırığı ver.
        </div>
      </div>

      {/* Performance mode */}
      <div className="space-y-2 pt-2">
        <button
          onClick={() => setOrchestrationMode(!orchestrationMode)}
          className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors"
          style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
          role="switch"
          aria-checked={orchestrationMode}
        >
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--fg-main)' }}>
            <Workflow size={14} style={{ color: orchestrationMode ? 'var(--color-accent)' : 'var(--fg-muted)' }} />
            Orchestra Mode
          </div>
          <div
            className="w-9 h-5 rounded-full relative transition-colors"
            style={{ background: orchestrationMode ? 'var(--color-accent)' : 'var(--fg-faint)' }}
          >
            <div
              className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
              style={{
                background: 'white',
                left: orchestrationMode ? '18px' : '2px',
              }}
            />
          </div>
        </button>
        <p className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
          Aktiv olduqda BahAI tapşırığı workflow üzrə planner/reviewer rolları ilə icra etməyə çalışır.
        </p>
      </div>

      <div className="space-y-1.5">
        <label style={labelStyle}>
          <Workflow size={12} /> Workflow
        </label>
        <select
          value={workflow}
          onChange={(e) => setWorkflow(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
          disabled={!orchestrationMode}
        >
          {WORKFLOW_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
        <p className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
          {WORKFLOW_OPTIONS.find((item) => item.id === workflow)?.description}
        </p>
      </div>

      <div className="space-y-2 pt-2 rounded-lg p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-2">
          <label style={{ ...labelStyle, marginBottom: 0 }}>
            <MonitorCog size={12} /> GUI Browser
          </label>
          <button
            onClick={scanBrowsers}
            className="text-[10px] px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg-main)] hover:bg-[var(--bg-hover)] text-[var(--fg-main)] font-semibold"
          >
            Sistemi skan et
          </button>
        </div>
        <label className="flex items-center justify-between gap-3 text-[12px]" style={{ color: 'var(--fg-secondary)' }}>
          <span>Start zamanı browser-i avtomatik aç</span>
          <input
            type="checkbox"
            checked={guiAutoStartBrowser}
            onChange={(e) => setGuiAutoStartBrowser(e.target.checked)}
          />
        </label>
        <select
          value={guiBrowserMode}
          onChange={(e) => setGuiBrowserMode(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          <option value="cdp">Attach to existing Chrome (CDP)</option>
          <option value="persistent">Real Chrome persistent profile</option>
          <option value="bundled">Chrome for Testing</option>
        </select>
        {browsers.length > 0 && (
          <select
            value={guiBrowserPath}
            onChange={(e) => setGuiBrowserPath(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="">Browser seç</option>
            {browsers.filter((item) => item.installed).map((item) => (
              <option key={item.id} value={item.path}>
                {item.name}{item.supportsCdp ? ' (CDP)' : ''}
              </option>
            ))}
          </select>
        )}
        <input
          value={guiBrowserCdpUrl}
          onChange={(e) => setGuiBrowserCdpUrl(e.target.value)}
          placeholder="http://127.0.0.1:9222"
          style={inputStyle}
        />
        <p className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
          CDP mode lazım olsa Chrome-u tələb zamanı özü qaldıra bilər. İstəsən ayrıca <code>npm run chrome:debug</code> ilə əvvəlcədən də başlada bilərsən.
        </p>
        {browserScanError && (
          <p className="text-[11px]" style={{ color: 'var(--color-danger)' }}>{browserScanError}</p>
        )}
      </div>

      <div className="space-y-1.5 pt-2">
        <button
          onClick={() => setPerformanceMode(!performanceMode)}
          className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors"
          style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
          role="switch"
          aria-checked={performanceMode}
        >
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--fg-main)' }}>
            <Zap size={14} style={{ color: performanceMode ? 'var(--color-accent)' : 'var(--fg-muted)' }} />
            Performans Rejimi
          </div>
          <div
            className="w-9 h-5 rounded-full relative transition-colors"
            style={{ background: performanceMode ? 'var(--color-accent)' : 'var(--fg-faint)' }}
          >
            <div
              className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
              style={{
                background: 'white',
                left: performanceMode ? '18px' : '2px',
              }}
            />
          </div>
        </button>
        <p className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
          Animasiyaları və arxa fon bulanıqlığını söndürərək performansı artırır.
        </p>
      </div>
      </>
      )}
    </div>
  );
}

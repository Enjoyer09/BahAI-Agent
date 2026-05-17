import { Code, Zap } from 'lucide-react';
import { MODELS } from '../../lib/constants';
import { useAuth } from '../../hooks/useAuth';

interface SettingsPanelProps {
  apiKey: string; setApiKey: (v: string) => void;
  baseUrl: string; setBaseUrl: (v: string) => void;
  model: string; setModel: (v: string) => void;
  projectDir: string; setProjectDir: (v: string) => void;
  performanceMode: boolean; setPerformanceMode: (v: boolean) => void;
}

function SettingField({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 animate-in fade-in duration-500">
      <label className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 opacity-50">
        <Icon size={12} /> {label}
      </label>
      {children}
    </div>
  );
}

export default function SettingsPanel({ 
  apiKey, setApiKey, baseUrl, setBaseUrl, model, setModel, 
  projectDir, setProjectDir, performanceMode, setPerformanceMode 
}: SettingsPanelProps) {
  
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const cls = "w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-blue-500/50 transition-all text-white";

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-2xl bg-blue-500/5 border border-blue-500/10 mb-4 animate-in fade-in duration-300">
        <div className="flex items-center gap-2 text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">
          <Zap size={14} className="animate-pulse" /> Bulud Sazlamaları
        </div>
        <p className="text-[10px] text-gray-500 leading-relaxed">
          Bütün API açarları və model bağlantıları təhlükəsiz şəkildə <strong>Railway Server</strong> tərəfindən idarə olunur. UI üzərində heç bir məxfi açar daxil etməyə ehtiyac yoxdur.
        </p>
      </div>

      {/* Everyone can change Model */}
      <SettingField icon={Code} label="AI Model Seçimi">
        <select value={model} onChange={e => setModel(e.target.value)} className={`${cls} appearance-none cursor-pointer border-blue-500/20`}>
          {MODELS.map(m => <option key={m.id} value={m.id} className="bg-[#1e2235]">{m.name}</option>)}
        </select>
      </SettingField>

      {/* PERFORMANCE MODE TOGGLE */}
      <div className="pt-2 border-t border-white/5">
        <button 
          onClick={() => setPerformanceMode(!performanceMode)}
          className={`w-full flex items-center justify-between p-3 rounded-2xl border transition-all ${
            performanceMode 
              ? 'bg-blue-600/20 border-blue-500/50 text-blue-400' 
              : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
          }`}
        >
          <div className="flex items-center gap-2 font-bold text-[10px] uppercase tracking-widest">
            <Zap size={14} className={performanceMode ? 'fill-blue-400' : ''} /> Performance Mode
          </div>
          <div className={`w-8 h-4 rounded-full relative transition-colors ${performanceMode ? 'bg-blue-500' : 'bg-gray-700'}`}>
            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${performanceMode ? 'right-0.5' : 'left-0.5'}`} />
          </div>
        </button>
      </div>
    </div>
  );
}

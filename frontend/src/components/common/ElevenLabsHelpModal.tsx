import { X, Mic, ExternalLink, Key, Sparkles, HelpCircle } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ElevenLabsHelpModal({ isOpen, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
      
      <div
        className="relative w-full max-w-lg rounded-2xl p-6 sm:p-8 animate-scale-in max-h-[90vh] overflow-y-auto premium-scroll"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-xl)',
          color: 'var(--fg-main)'
        }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-md transition-colors"
          style={{ color: 'var(--fg-muted)', minHeight: '44px', minWidth: '44px' }}
          aria-label="Bağla"
        >
          <X size={18} />
        </button>

        {/* Dynamic Voice Wave Animation Header */}
        <div className="text-center mb-6 pt-4">
          <div className="relative w-20 h-20 mx-auto flex items-center justify-center mb-4">
            {/* Glowing pulses */}
            <div className="absolute inset-0 rounded-full bg-indigo-500/10 animate-ping" style={{ animationDuration: '3s' }} />
            <div className="absolute inset-2 rounded-full bg-purple-500/20 animate-pulse" style={{ animationDuration: '2s' }} />
            
            {/* Main Orb */}
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center relative z-10"
              style={{
                background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
                boxShadow: '0 4px 15px rgba(168, 85, 247, 0.4)'
              }}
            >
              <Mic size={24} className="text-white" />
            </div>
            
            {/* Animated equalizer waves */}
            <div className="absolute -bottom-1 flex items-end justify-center gap-1 h-4">
              <span className="w-1 bg-purple-500 rounded-full animate-bounce" style={{ height: '60%', animationDelay: '0.1s' }} />
              <span className="w-1 bg-indigo-500 rounded-full animate-bounce" style={{ height: '100%', animationDelay: '0.3s' }} />
              <span className="w-1 bg-purple-500 rounded-full animate-bounce" style={{ height: '40%', animationDelay: '0.5s' }} />
              <span className="w-1 bg-indigo-500 rounded-full animate-bounce" style={{ height: '80%', animationDelay: '0.2s' }} />
            </div>
          </div>

          <h2 id="modal-title" className="text-xl font-bold tracking-tight" style={{ color: 'var(--fg-main)' }}>
            ElevenLabs Səsli Dialoq
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--fg-muted)' }}>
            ChatGPT-style Speech-to-Speech (Canlı Səsli Əlaqə)
          </p>
        </div>

        {/* Content Tabs / Info */}
        <div className="space-y-5 text-sm">
          {/* Key Value Proposition */}
          <div
            className="p-4 rounded-xl flex items-start gap-3 border"
            style={{
              background: 'rgba(168, 85, 247, 0.05)',
              borderColor: 'rgba(168, 85, 247, 0.15)'
            }}
          >
            <Sparkles size={18} className="text-purple-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-purple-300">Bu nədir?</p>
              <p className="mt-1 leading-relaxed" style={{ color: 'var(--fg-secondary)' }}>
                Bu rejim sayəsində bahAI ilə yazışmaq yerinə, tamamilə şifahi, gecikməsiz və olduqca təbii bir insan səsi ilə **Speech-to-Speech** (səsli dialoq) qura bilərsiniz. Agent sizin mikrofona danışdıqlarınızı eşidir və canlı cavab verir.
              </p>
            </div>
          </div>

          {/* Guide Steps */}
          <div>
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--fg-main)' }}>
              <HelpCircle size={16} className="text-purple-400" />
              ElevenLabs Agentinin Qurulması (Tamamilə Pulsuz)
            </h3>
            
            <ol className="space-y-3 pl-5 list-decimal leading-relaxed" style={{ color: 'var(--fg-secondary)' }}>
              <li>
                <strong>Hesab yaradın:</strong> <a href="https://elevenlabs.io" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline inline-flex items-center gap-0.5 font-medium">elevenlabs.io <ExternalLink size={12} /></a> saytında pulsuz qeydiyyatdan keçin.
              </li>
              <li>
                <strong>Conversational AI tapın:</strong> Sol paneldə <strong>&quot;Conversational AI&quot;</strong> (və ya bəzi interfeyslərdə <strong>&quot;Agents&quot;</strong>) menyusunu seçin.
              </li>
              <li>
                <strong>Agent yaradın:</strong> <strong>&quot;Create New Agent&quot;</strong> düyməsinə klikləyin, ona <em>bahAI</em> adı verin, birinci səsli mesajını təyin edin.
              </li>
              <li>
                <strong>Agent ID kopyalayın:</strong> Yaradılmış agentin səhifəsində <strong>&quot;Agent ID&quot;</strong> parametrini kopyalayın (məsələn: <code>agent_1301kt1m8gq7f8...</code>).
              </li>
              <li>
                <strong>API Key əldə edin:</strong> Sol aşağı küncdəki Profil şəklinizə klikləyin → <strong>&quot;Profile + API Keys&quot;</strong> bölməsindən şəxsi API Key-inizi kopyalayın (məsələn: <code>sk_7f86d2...</code>).
              </li>
            </ol>
          </div>

          {/* Environment Config */}
          <div>
            <h3 className="font-semibold text-sm mb-2 flex items-center gap-2" style={{ color: 'var(--fg-main)' }}>
              <Key size={16} className="text-purple-400" />
              Layihənin Konfiqurasiyası
            </h3>
            <p className="mb-2 leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
              Açdığınız layihə qovluğunda yerləşən <code>.env</code> faylını redaktə edin və kopyaladığınız parametrləri daxil edin:
            </p>
            <div
              className="p-3 rounded-lg font-mono text-xs overflow-x-auto border"
              style={{
                background: 'var(--bg-hover)',
                borderColor: 'var(--border)',
                color: 'var(--fg-secondary)'
              }}
            >
              ELEVENLABS_API_KEY=sizin_elevenlabs_api_keyiniz<br />
              ELEVENLABS_AGENT_ID=sizin_agent_id_niz
            </div>
            
            <p className="mt-3 leading-relaxed text-xs" style={{ color: 'var(--fg-muted)' }}>
              ⚠️ <strong>Vacib:</strong> Konfiqurasiyanı tamamladıqdan sonra tətbiqi tamamilə bağlayın (Cmd+Q) və yenidən başladın: <code>npm run local</code> (və ya Electron). Bu zaman sağ aşağı küncdə <strong>bənövşəyi rəngdə işıq saçan ElevenLabs səs dairəsi</strong> görünəcək!
            </p>
          </div>
        </div>

        {/* Modal Action Buttons */}
        <div className="mt-6 pt-4 flex flex-col sm:flex-row gap-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <a
            href="https://elevenlabs.io"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer text-white"
            style={{
              background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
              minHeight: '44px'
            }}
          >
            ElevenLabs-a keçid
            <ExternalLink size={14} />
          </a>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all border cursor-pointer"
            style={{
              background: 'var(--bg-hover)',
              borderColor: 'var(--border)',
              color: 'var(--fg-secondary)',
              minHeight: '44px'
            }}
          >
            Anladım, bağla
          </button>
        </div>
      </div>
    </div>
  );
}

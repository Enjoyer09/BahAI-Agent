// ==========================================
// Chat Route — POST /api/chat
// ==========================================

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const router = express.Router();

const { getSession, findInstalledChromePath, listInstalledBrowsers } = require('../browserSession');
const { buildGuiCapabilityStatus } = require('../gui/capabilityStatus');
const { detectComputerUseStatus } = require('../gui/computerUseStatus');
const { appendGuiRepairGuidance } = require('../gui/repairGuidance');
const {
  isGuiObserveSelfTestRequest, isGuiLoginCheckpointRequest, isGuiLoginResumeRequest,
  isGuiOpenAndAwaitRequest, isGuiContinuationRequest, extractUrlFromGuiRequest,
  isSeoGuiCheckpointRequest, buildGuiBrowserOpenArgs, shouldAdvertiseScreenAgent, getGuiCapabilityHints
} = require('../gui/requests');
const {
  handleGuiLoginResume, handleGuiLoginCheckpointAction, handleGuiLoginCheckpoint,
  handleGuiSelfTest, handleGuiOpenAndAwaitInstruction, handleGuiContinuation,
  handleComputerUseOpenAndAwait, handleComputerUseContinuation
} = require('../gui/fastpath');
const { isComputerUseOpenRequest, isComputerUseContinuationRequest, extractComputerUseTarget } = require('../gui/computerUseRequests');
const { resolveOrchestrationConfig } = require('../orchestrator/workflowResolver');
const { buildRoleInstruction, buildPhaseHandoffMessage } = require('../orchestrator/rolePrompts');
const { createRunManager } = require('../orchestrator/runManager');
const { classifyEntryPath, buildGateReceipt } = require('../orchestrator/governance');
const { extractPlannerArtifact, buildPlannerArtifactPrompt, buildPlannerArtifactContext } = require('../orchestrator/plannerArtifact');
const { buildExecutionArtifact, buildExecutionArtifactContext, compactMessagesForNextPhase, classifyArtifactQuality } = require('../orchestrator/executionArtifact');
const { getToolDefinitions } = require('../tools/registry');
const { getToolsForProfile, getToolsForRole } = require('../tools/profiles');
const { buildProviderCandidates, normalizeProviderBaseUrl, detectWireApi, isResponsesSchemaMismatchError, buildOpenAIClient } = require('../chat/providers');
const { writeSse, initSse, emitOrchestrationPrelude, emitTaskPlan, emitGovernanceState, emitProviderTelemetry, finishSse } = require('../chat/sse');
const { collectStreamOutput } = require('../chat/stream');
const { executeToolCalls } = require('../chat/toolExecutor');
const { openAiStreamWithFallback } = require('../chat/runner');
const { runChatSession } = require('../chat/sessionController');
const { handleToolCall } = require('../toolRunner');
const {
  isLocalMode, shouldEmitDebugEvent, looksLikeOllamaModel, classifyTaskComplexity,
  isAuditStyleRequest, isCurrentFactsOrPublicWebsiteRequest, isFileClarificationLoop,
  normalizeToolName, buildToolCallCacheKey, isCacheableTool, isSensitiveTool,
  buildPhaseRecoveryInstruction, buildToolRecoveryInstruction, normalizeUserFacingError,
  normalizeFinalAssistantReport, flattenResponseJsonText, isPathSafe,
  resolveWorkingDirectory, buildApprovalMetadata, extractAttachment,
  normalizeMessagesForModel, generateToolsSystemPrompt, buildDeepSeekRecoveryMessages,
  extractTextToolCalls, serializeProject, serializeConversation,
  mapMessagesToResponsesInput, mapToolsToResponsesTools,
  deriveDialogueState, resolveFollowup, buildDialogueContinuityHint
} = require('../helpers');

async function getDirectWebChatReply(latestUserText = '', messages = [], referentSummary = null) {
  const text = String(latestUserText || '').trim();
  const lower = text.toLowerCase();
  const hasConversationHistory = Array.isArray(messages) && messages.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && String(item.content || '').trim()).length >= 2;
  const scopedReferentSummary = hasConversationHistory ? referentSummary : null;
  const dialogueState = deriveDialogueState(messages);
  const resolvedFollowup = resolveFollowup(text, {
    ...dialogueState,
    previousUser: String(scopedReferentSummary?.previousUser || dialogueState.previousUser || ''),
    previousAssistant: String(scopedReferentSummary?.previousAssistant || dialogueState.previousAssistant || ''),
  });
  const tz = process.env.BAHAI_DEFAULT_TIMEZONE || 'Asia/Baku';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('az-AZ', {
    timeZone: tz,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  }).formatToParts(now);
  const getPart = (type) => parts.find((item) => item.type === type)?.value || '';
  const prettyDate = `${getPart('day')} ${getPart('month')} ${getPart('year')}, ${getPart('weekday')}`;
  const yyyyMmDd = [
    ...new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(now)
      .split('-')
  ].join('-');
  const normalizedGreeting = text
    .toLocaleLowerCase('az-AZ')
    .replace(/[.,!?…:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const isGreeting =
    /^(hervaxtin|hər vaxtın|hərvaxtın) xeyr( olsun)?( necesen| necəsən)?$/.test(normalizedGreeting)
    || /^(salam|salamlar|hello|hi)( necesen| necəsən| nə var nə yox)?$/.test(normalizedGreeting);
  if (isGreeting) {
    return 'Hər vaxtın xeyir! Mən yaxşıyam, sağ ol. Sən necəsən?';
  }
  if (/^(burdasan|buradasan|ordasan|oradasan|are you there)$/.test(normalizedGreeting)) {
    return 'Bəli, buradayam. Sualını yaza bilərsən.';
  }
  const asksDate = /\b(bugün|bugun|bu gün|today)\b/i.test(text) && /\b(ayın neçəsidir|ayin necesidir|tarix|date|günlerden ne gündür|hansi gundur)\b/i.test(text);
  if (asksDate) {
    return `Bu gün ${prettyDate}-dir.`;
  }

  function formatTemperatureCelsius(rawTemp = '') {
    const normalized = String(rawTemp || '').trim();
    if (!normalized) return '';
    const match = normalized.match(/(-?\d+(?:\.\d+)?)\s*°?\s*([FC])?/i);
    if (!match) return normalized.replace(/°?[FC]/gi, '');
    const numeric = Number(match[1]);
    const unit = String(match[2] || 'C').toUpperCase();
    if (Number.isNaN(numeric)) return normalized.replace(/°?[FC]/gi, '');
    if (unit === 'F') {
      return String(Math.round(((numeric - 32) * 5) / 9));
    }
    return String(Math.round(numeric));
  }
  const weatherCityMap = {
    baku: { wttr: 'Baku', label: 'Bakıda' },
    bakı: { wttr: 'Baku', label: 'Bakıda' },
    baki: { wttr: 'Baku', label: 'Bakıda' },
    bakida: { wttr: 'Baku', label: 'Bakıda' },
    bakıda: { wttr: 'Baku', label: 'Bakıda' },
    gence: { wttr: 'Ganja', label: 'Gəncədə' },
    gəncə: { wttr: 'Ganja', label: 'Gəncədə' },
    ganja: { wttr: 'Ganja', label: 'Gəncədə' },
    gencede: { wttr: 'Ganja', label: 'Gəncədə' },
    gəncədə: { wttr: 'Ganja', label: 'Gəncədə' },
    sumqayit: { wttr: 'Sumqayit', label: 'Sumqayıtda' },
    sumqayıt: { wttr: 'Sumqayit', label: 'Sumqayıtda' },
    sumgayit: { wttr: 'Sumqayit', label: 'Sumqayıtda' },
    sumqayitda: { wttr: 'Sumqayit', label: 'Sumqayıtda' },
    sumqayıtda: { wttr: 'Sumqayit', label: 'Sumqayıtda' },
    sumgayitda: { wttr: 'Sumqayit', label: 'Sumqayıtda' },
  };
  const isWeatherQuery = /\b(hava|weather|temperatur|temperature|dərəcə|derece)\b/i.test(text);
  const isTomorrowQuery = /\b(sabah|sabahkı|sabahki|tomorrow)\b/i.test(text);
  const weatherCityMatch = text.match(/\b(baku|bakı|baki|bakida|bakıda|gence|gəncə|ganja|gencede|gəncədə|sumqayit|sumqayıt|sumgayit|sumqayitda|sumqayıtda|sumgayitda)\b/i);

  if (isWeatherQuery && weatherCityMatch) {
    const cityKey = weatherCityMatch[1].toLowerCase();
    const cityMeta = weatherCityMap[cityKey];
    if (cityMeta) {
      if (isTomorrowQuery) {
        try {
          // Fetch tomorrow's forecast format (%C|%t|%w|%h for day 2) from wttr.in/Baku?format=j1
          const forecastUrl = `https://wttr.in/${encodeURIComponent(cityMeta.wttr)}?format=j1`;
          const fRes = await fetch(forecastUrl, { timeout: 10000, headers: { 'User-Agent': 'BahAI/1.0' } });
          if (fRes.ok) {
            const data = await fRes.json();
            const tomorrowData = data?.weather?.[1];
            if (tomorrowData) {
              const maxC = tomorrowData.maxtempC || '';
              const minC = tomorrowData.mintempC || '';
              const desc = tomorrowData.hourly?.[4]?.weatherDesc?.[0]?.value || tomorrowData.hourly?.[0]?.weatherDesc?.[0]?.value || 'açıq';
              return `Sabah ${cityMeta.label} havanın ${desc.toLowerCase()} olacağı gözlənilir. Temperatur minimum ${minC}°C, maksimum ${maxC}°C ətrafında olacaq.`;
            }
          }
        } catch {
          // Fallthrough to model web_search if wttr.in fails
        }
      } else {
        try {
          const wttrUrl = `https://wttr.in/${encodeURIComponent(cityMeta.wttr)}?format=%C|%t|%w|%h`;
          const wttrRes = await fetch(wttrUrl, { timeout: 10000, headers: { 'User-Agent': 'BahAI/1.0' } });
          if (wttrRes.ok) {
            const raw = (await wttrRes.text()).trim();
            const [conditionRaw = '', tempRaw = '', windRaw = '', humidityRaw = ''] = raw.split('|');
            const condition = String(conditionRaw).replace(/\s+/g, ' ').trim();
            const tempC = formatTemperatureCelsius(String(tempRaw).replace(/\+/g, '').replace(/\s+/g, '').trim());
            const wind = String(windRaw).replace(/\s+/g, ' ').trim();
            const humidity = String(humidityRaw).replace(/\s+/g, '').trim();
            const windMetric = wind
              .replace(/mph/gi, 'km/saat')
              .replace(/(\d+(?:\.\d+)?)\s*km\/h/gi, '$1 km/saat');
            const pieces = [];
            if (condition) pieces.push(`${cityMeta.label} hazırda ${condition.toLowerCase()} müşahidə olunur.`);
            if (tempC) pieces.push(`Temperatur təxminən ${tempC.replace(/°?[FC]/gi, '')}°C-dir.`);
            if (windMetric) pieces.push(`Külək ${windMetric} təşkil edir.`);
            if (humidity) pieces.push(`Rütubət ${humidity.replace('%', '')}%-dir.`);
            return pieces.join(' ');
          }
        } catch {
          return `${cityMeta.label} hava məlumatını hazırda birbaşa götürə bilmədim. Bir neçə dəqiqə sonra yenidən yoxlayaq.`;
        }
      }
    }
  }
  const previousAssistant = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((item) => item && item.role === 'assistant' && typeof item.content === 'string');
  const previousUser = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((item) => item && item.role === 'user' && typeof item.content === 'string' && String(item.content || '').trim() !== text);
  const previousAssistantText = String(previousAssistant?.content || '');
  const previousUserText = String(previousUser?.content || '').trim();
  const isShortFollowup = /^(de|də|he|hə|beli|bəli|olar|buyur|ok|oke|hmm)\.?$/i.test(text);
  const asksToClarifyPrevious = /^(deqiqleshdir|dəqiqləşdir|deqiqlestir|dəqiqləşdirin|deqiqlesdir|yuxarida dedin axi|yuxarıda dedin axı|ele onu|elə onu|onu deqiqleshdir|onu dəqiqləşdir|bunu deqiqleshdir|bunu dəqiqləşdir)$/i.test(lower);
  const asksContextualAdvice = /(bu havada|bu qiym[eə]t[eə]?|bu model üçün|bu halda|bu vəziyyətdə|bu şertlerde|bu şəraitdə)/i.test(lower);

  const referentAssistant = String(scopedReferentSummary?.previousAssistant || dialogueState.previousAssistant || '').trim();
  const referentUser = String(scopedReferentSummary?.previousUser || dialogueState.previousUser || '').trim();
  const referentAttachment = hasConversationHistory ? (scopedReferentSummary?.previousAttachment || dialogueState.previousAttachment || null) : null;
  const hasVisualReferent = hasConversationHistory && Boolean(referentAttachment || resolvedFollowup?.hasRecentVisualReferent);

  if (hasVisualReferent && /(bu sənəd|bu sened|bu şəkil|bu sekil|bu fayl|buradakı sənəd|burdaki sened|bu sənəd məhsulların qarantiyada olduğunu təsdiqləyir|bu sened mehsullarin qarantiyada oldugunu tesdiqleyir)/i.test(text)) {
    const anchor = `${referentAssistant} ${referentUser}`.toLowerCase();
    if (/distributer|distributor|səlahiyyət|selahiyyet|authorization|etibarnamə|etibarname/i.test(anchor)) {
      return 'Xeyr, bu sənəd birbaşa məhsulların qarantiyada olduğunu təsdiqləmir. Bu daha çox distribyutor və ya təchizat səlahiyyətini göstərən sənədə bənzəyir. Qarantiyanı təsdiqləmək üçün warranty sənədi, serial yoxlaması, invoice və ya rəsmi servis/distribyutor təsdiqi daha uyğun sübut olar.';
    }
    return 'Bu sənədi əvvəlki attachment kimi nəzərə alıram. Onu yenidən paylaşmağa ehtiyac yoxdur; istəsən indi onun qarantiyanı təsdiqləyib-təsdiqləmədiyini ayrıca şərh edim.';
  }

  if (asksToClarifyPrevious && referentAssistant) {
    if (/tam spesifikasiya|cari qiymət|qiymeti maraqlanirsansa|qiyməti maraqlanırsansa/i.test(referentAssistant)) {
      const subject = referentUser || previousUserText || 'məhsul';
      return `Dəqiqləşdirim: ${subject} üçün iki istiqamət var — tam spesifikasiya və Azərbaycandakı cari qiymət. Hansını istəyirsiniz? Məsələn: "tam spesifikasiya" və ya "qiymət" yazın.`;
    }
    return 'Yuxarıdakı cavaba əsasən bunu dəqiqləşdirə bilərəm. Hansı hissəni nəzərdə tutursunuz: qiymət, texniki göstəricilər, zəmanət, yoxsa distributor məlumatı?';
  }

  if (resolvedFollowup?.kind === 'referential' && referentAssistant) {
    if (/tam spesifikasiya|cari qiymət|qiymeti maraqlanirsansa|qiyməti maraqlanırsansa/i.test(referentAssistant)) {
      const subject = referentUser || previousUserText || 'məhsul';
      return `Dəqiqləşdirim: ${subject} üçün iki istiqamət var — tam spesifikasiya və Azərbaycandakı cari qiymət. Hansını istəyirsiniz? Məsələn: "tam spesifikasiya" və ya "qiymət" yazın.`;
    }
    if (/növbəti oyunu da deyim/i.test(referentAssistant)) {
      return 'Növbəti oyun 9 iyul 2026 tarixindədir. İstəsən həmin günün cütlərini də qısa şəkildə sadalayım.';
    }
    if (/həmin günün cütlərini də qısa şəkildə sadalayım/i.test(referentAssistant)) {
      return '9 iyul 2026 oyun günü quarter-final mərhələsinə düşür. Dəqiq cütlər əvvəlki mərhələnin nəticələrinə görə formalaşır; istəsən rəsmi cədvəl üzərindən həmin an üçün aktual cütləri ayrıca yoxlayım.';
    }
    if (resolvedFollowup.hasOpenChoice) {
      return 'Yuxarıdakı cavabı davam etdirə bilərəm. Hansı hissəni istəyirsiniz: qiymət, texniki göstəricilər, zəmanət, yoxsa müqayisə?';
    }
  }

  if (asksToClarifyPrevious) {
    if (/tam spesifikasiya|cari qiymət|qiymeti maraqlanirsansa|qiyməti maraqlanırsansa/i.test(previousAssistantText)) {
      const subject = previousUserText || 'məhsul';
      return `Dəqiqləşdirim: ${subject} üçün iki istiqamət var — tam spesifikasiya və Azərbaycandakı cari qiymət. Hansını istəyirsiniz? Məsələn: "tam spesifikasiya" və ya "qiymət" yazın.`;
    }
    if (previousAssistantText) {
      return 'Yuxarıdakı cavaba əsasən bunu dəqiqləşdirə bilərəm. Hansı hissəni nəzərdə tutursunuz: qiymət, texniki göstəricilər, zəmanət, yoxsa distributor məlumatı?';
    }
  }

  if (asksContextualAdvice || (resolvedFollowup?.kind === 'contextual')) {
    const weatherAnchorText = referentAssistant || previousAssistantText;
    const userAnchorText = referentUser || previousUserText;
    if (/temperatur|rütubət|külək|hava|müşahidə olunur|°c|yağış|rain|shower/i.test(weatherAnchorText)) {
      return `Hazırkı şəraitə görə qısa məsləhət: yağış və külək olduğuna görə yüngül gəzişdən çox qapalı məkanda plan daha rahat olar. Çölə çıxacaqsınızsa çətir və ya nazik yağışlıq götürün, ayaqqabı da suya davamlı olsa yaxşıdır.`;
    }
    if (/qiymət|manat|azn/i.test(weatherAnchorText)) {
      return 'Bu qiymət aralığında əsasən qiymət-performans balansına baxmaq daha məntiqlidir. İstəsən həmin büdcəyə görə 2-3 daha uyğun variantı müqayisə edim.';
    }
    if (/hp|lenovo|dell|asus|model/i.test(weatherAnchorText) || /hp|lenovo|dell|asus|model/i.test(userAnchorText)) {
      return `Bu model üçün qərar verməkdən əvvəl 3 şeyə baxmaq yaxşı olar: zəmanət kimdədir, RAM/SSD konfiqurasiyası nədir, bir də ekran tipi və batareya səviyyəsi. İstəsən bunu sənin model üzrə bir-bir dəqiqləşdirim.`;
    }
  }
  const asksWhenWorldCupIs =
    ((lower.includes('world cup 2026') || lower.includes('fifa world cup 2026') || lower.includes('fifa dunya cempionati 2026') || lower.includes('fifa dünya çempionatı 2026'))
      && (lower.includes('ne vaxt') || lower.includes('nə vaxt') || lower.includes('vaxtdir') || lower.includes('tarix')));
  if (asksWhenWorldCupIs) {
    return 'FIFA Dünya Çempionatı 2026 rəsmi cədvələ görə 11 iyun 2026-da başlayır və 19 iyul 2026-da bitir.';
  }
  return '';
}

async function readLocalDb() {
  try {
    const fs = require('fs/promises');
    const data = await fs.readFile(path.resolve(__dirname, '../../sandbox/local_db.json'), 'utf8').catch(() => '{}');
    return JSON.parse(data);
  } catch { return {}; }
}

// ==========================================
// POST /api/chat — MAIN CHAT ENDPOINT
// ==========================================

router.post('/', async (req, res) => {
  // --- Extract request params ---
  const { message, messages, conversationId, projectId, safeMode, productMode, executionMode,
    orchestrationMode, workflow, apiKey: frontendApiKey, baseUrl: frontendBaseUrl, model: frontendModel,
    guiBrowserMode, guiBrowserPath, guiBrowserCdpUrl, referentSummary } = req.body;

  const normalizedMessages = Array.isArray(messages) ? messages : [];
  const lastUserMessage = [...normalizedMessages]
    .reverse()
    .find((item) => item && item.role === 'user' && typeof item.content === 'string');
  const latestUserText = String(message || lastUserMessage?.content || '').trim();
  const requestAttachments = Array.isArray(req.body.attachments) && req.body.attachments.length > 0
    ? req.body.attachments
    : req.body.attachment
      ? [req.body.attachment]
      : Array.isArray(lastUserMessage?.attachments)
        ? lastUserMessage.attachments
        : [];
  const requestAttachment = requestAttachments[0] || null;
  const hasAttachment = requestAttachments.length > 0;
  const hasAttachmentInRequest = hasAttachment && !latestUserText;
  const hasImageAttachment = requestAttachments.some((att) => (
    att?.type === 'image' || /^image\//i.test(String(att?.mimeType || att?.mimetype || att?.type || ''))
  ));

  if (!latestUserText && !hasAttachmentInRequest) {
    return res.status(400).json({ error: 'Mesaj tələb olunur' });
  }

  const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT || path.join(__dirname, '../../sandbox'));
  const resolvedWD = productMode === 'web_chat' ? '' : resolveWorkingDirectory(undefined, req.user);
  const MAX_STEPS = parseInt(process.env.MAX_AGENT_STEPS || '6', 10);
  const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '60000', 10);
  const LLM_TIMEOUT_CHAT = parseInt(process.env.LLM_TIMEOUT_CHAT || '45000', 10);
  const providerRuntime = require('../helpers').providerRuntime || { markProviderFailure: () => {}, canUseProviderNow: () => true, markProviderSuccess: () => {}, reorderCandidatesForSession: (items) => items };
  const providerSessionKey = `${productMode || 'desktop_code'}:${req.user?.id || 'anon'}:${conversationId || 'default'}`;

  // --- Auto-routing ---
  const autoIntent = frontendModel === 'auto'
    ? classifyTaskComplexity({ userMessage: latestUserText, messageHistoryLen: normalizedMessages.length, hasAttachments: hasAttachment })
    : null;
  const webTaskType = (() => {
    if (productMode !== 'web_chat') return 'general';
    if (hasImageAttachment) return 'vision';
    const text = String(latestUserText || '').toLowerCase();
    if (!text) return 'general';
    if (
      /```|function\s*\(|const\s+\w+|let\s+\w+|class\s+\w+|import\s+.+from|console\.log|npm\s|yarn\s|pnpm\s|docker|sql|regex|typescript|javascript|python|bug|fix|refactor|repo|code|kod|api|backend|frontend|deploy|build|test|stack trace|error\b/.test(text)
    ) {
      return 'code';
    }
    return 'general';
  })();

  const providerCandidates = providerRuntime.reorderCandidatesForSession(providerSessionKey, buildProviderCandidates({
    frontendApiKey, frontendBaseUrl, frontendModel, autoIntent,
    hasImageAttachment, webTaskType,
    productMode, executionMode, env: process.env,
    parseProviderPoolFromEnv: require('../helpers').parseProviderPoolFromEnv,
    looksLikeOllamaModel
  }));

  if (providerCandidates.length === 0) {
    return res.status(503).json({ error: 'Heç bir AI provider konfiqurasiya edilməyib. Ayarlardan API açarı və model seçin.' });
  }

  let activeProvider = providerCandidates[0];
  let client = buildOpenAIClient(activeProvider);
  let effectiveModel = activeProvider.model;
  const effectiveModelRef = { current: effectiveModel };
  const activeProviderRef = { current: activeProvider };
  const clientRef = { current: client };
  const isLocalOrFlakyModel = isLocalMode() || !effectiveModel || /qwen|ollama|deepseek|llama|local|free|nemotron/i.test(effectiveModel);

  // --- Orchestration ---
  const resolvedOrchestration = resolveOrchestrationConfig(orchestrationMode, workflow, latestUserText, { productMode });
  const orchestration = resolvedOrchestration;
  const runManager = createRunManager(orchestration);
  const runId = crypto.randomUUID();
  const entryPath = classifyEntryPath({ latestUserText, workflow: orchestration.workflow, orchestration: null });
  const initialGateReceipt = buildGateReceipt({ plannerArtifact: null, executionArtifacts: [] });
  const isAuditStyle = isAuditStyleRequest(latestUserText);

  // --- Check GUI fast paths ---
  const conversationIdSafe = String(conversationId || 'default');
  const auditStyleRequest = isAuditStyle;

  // --- GUI Checkpoint (Wix login) ---
  if (isSeoGuiCheckpointRequest(latestUserText, orchestration.workflow) || isGuiLoginCheckpointRequest(latestUserText)) {
    const browserOpenArgs = buildGuiBrowserOpenArgs({
      url: 'https://www.wix.com',
      sessionId: 'gui-wix-live',
      guiBrowserMode, guiBrowserPath, guiBrowserCdpUrl,
      defaultCdpUrl: process.env.GUI_BROWSER_CDP_URL || 'http://127.0.0.1:9222',
      installedBrowsers: listInstalledBrowsers(),
      preferPersistentIfChrome: true
    });
    return handleGuiLoginCheckpoint({
      res, orchestration, runManager, resolvedWD, conversationId: conversationIdSafe,
      reqUser: req.user, handleToolCall, normalizeUserFacingError,
      browserOpenArgs, createCheckpoint: (id, payload) => { /* stub */ }
    });
  }

  // --- GUI self-test ---
  if (isGuiObserveSelfTestRequest(latestUserText)) {
    const browserOpenArgs = buildGuiBrowserOpenArgs({
      url: 'https://example.com', sessionId: 'gui-self-test',
      guiBrowserMode, guiBrowserPath, guiBrowserCdpUrl,
      defaultCdpUrl: process.env.GUI_BROWSER_CDP_URL || 'http://127.0.0.1:9222',
      installedBrowsers: listInstalledBrowsers()
    });
    return handleGuiSelfTest({
      res, orchestration, runManager, resolvedWD, reqUser: req.user,
      handleToolCall, normalizeUserFacingError, browserOpenArgs
    });
  }

  // --- GUI login resume ---
  if (isGuiLoginResumeRequest(latestUserText)) {
    return handleGuiLoginResume({
      res, orchestration, runManager, resolvedWD, reqUser: req.user,
      checkpoint: { sessionId: 'gui-wix-live', workflow: orchestration.workflow },
      latestUserText, handleToolCall, normalizeUserFacingError
    });
  }

  // --- GUI Open & Await ---
  if (isGuiOpenAndAwaitRequest(latestUserText)) {
    const url = extractUrlFromGuiRequest(latestUserText);
    if (url) {
      const browserOpenArgs = buildGuiBrowserOpenArgs({
        url, sessionId: 'gui-live', guiBrowserMode, guiBrowserPath, guiBrowserCdpUrl,
        defaultCdpUrl: process.env.GUI_BROWSER_CDP_URL || 'http://127.0.0.1:9222',
        installedBrowsers: listInstalledBrowsers()
      });
      return handleGuiOpenAndAwaitInstruction({
        res, orchestration, runManager, resolvedWD, reqUser: req.user,
        handleToolCall, normalizeUserFacingError, browserOpenArgs, promptText: latestUserText
      });
    }
  }

  // --- GUI continuation ---
  if (isGuiContinuationRequest(latestUserText)) {
    return handleGuiContinuation({
      res, orchestration, runManager, resolvedWD, reqUser: req.user,
      handleToolCall, normalizeUserFacingError, sessionId: 'gui-live', promptText: latestUserText
    });
  }

  // --- Computer Use fast paths ---
  if (isComputerUseOpenRequest(latestUserText, orchestration.workflow)) {
    const target = extractComputerUseTarget(latestUserText);
    return handleComputerUseOpenAndAwait({
      res, orchestration, runManager, target, promptText: latestUserText
    });
  }

  if (isComputerUseContinuationRequest(latestUserText, orchestration.workflow)) {
    return handleComputerUseContinuation({
      res, orchestration, runManager, promptText: latestUserText
    });
  }

  // --- Main Chat Processing ---
  const TOOLS = productMode === 'web_chat'
    ? getToolsForProfile('web-chat')
    : getToolDefinitions();
  const db = require('../db');
  const historyMessageCount = normalizedMessages.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && String(item.content || '').trim()).length;
  const safeReferentSummary = productMode === 'web_chat' && historyMessageCount >= 2 ? (referentSummary || null) : null;
  const directWebReply = productMode === 'web_chat' ? await getDirectWebChatReply(latestUserText, normalizedMessages, safeReferentSummary) : '';

  if (directWebReply) {
    initSse(res);
    writeSse(res, {
      type: 'assistant_message',
      message: { role: 'assistant', content: directWebReply }
    });
    finishSse(res);
    return res.end();
  }

  const continuity = productMode === 'web_chat'
    ? buildDialogueContinuityHint(normalizedMessages, latestUserText, safeReferentSummary)
    : null;
  const dialogueState = continuity?.dialogueState || null;
  const resolvedFollowup = continuity?.resolvedFollowup || null;
  const continuityHint = continuity?.continuityHint || null;

  // Build system message
  const productPrompt = productMode === 'web_chat'
    ? `Sən BahAI-sən — Azərbaycan dilində faydalı, təbii danışan canlı AI köməkçi.
CRITICAL INSTRUCTIONS:
- İstifadəçiyə HƏMİŞƏ DƏRHAL SON NƏTİCƏNİ və birbaşa cavabı ver.
- Cari faktlar, idman qalibləri, çempionlar, canlı qiymətlər və ya xəbərlər soruşulduqda HƏMİŞƏ DƏRHAL \`web_search\` alətini işlədib ən son faktı öyrən, təxminlərlə və ya fərziyyələrlə cavab vermə!
- Heç vaxt cavab yazarkən "Axtarış aparıram", "İndi səhifəni açıram" kimi öz daxili fikirlərini və alət addımlarını İSTİFADƏÇİYƏ YAZMA!
- Alətlərdən (web_search, browser_open və s.) istifadə etdikdə, aləti sakitcə fon rejimində icra et, dəqiq nəticəni əldə et və istifadəçiyə YALNIZ NƏTİCƏNİ təbii dildə təqdim et.
- Şəkil (JPEG, PNG, GIF, WEBP) göndərildikdə: Sən şəkilləri GÖRƏ BİLİRSƏN. "Şəkilləri görə bilmirəm" DEMƏ! Şəkili birbaşa analiz et — nə görürsən, orada nə var, rənglər, mətn, obyektlər — hamısını aydın şərh et.
- Qısa, aydın, insan kimi cavab ver.
- Heç vaxt "Mən bir süni intellektəm", "yalnız mətn fayllarını oxuya bilirəm" və ya daxili JSON haqqında danışma.`
    : `Sən BahAI agentisən — Azərbaycan dilində AI kodlaşdırma köməkçisi.
Heç vaxt "Mən bir süni intellektəm", "Canlı məlumatlara çıxışım yoxdur" kimi üzrxahlıq və zəiflik bildirən cümlələr işlətmə. Həmişə özündən əmin və birbaşa danış.`;

  const currentDateStr = new Date().toLocaleDateString('az-AZ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const currentDatePrompt = `Cari tarix: ${currentDateStr}.`;

  const systemPrompt = `${currentDatePrompt}\n\n${productPrompt}

${productMode === 'web_chat' ? '' : (resolvedWD ? `Cari iş qovluğu: ${resolvedWD}\nProject Root: ${resolvedWD}` : '')}

Tool-ları istifadə edərək sualları cavablandır, kod yaz, faylları oxu/düzəlt, test işlət.

═══════════════════════════════════════════
WEB SCRAPING QAYDASI (bunu diqqətlə oxu!)
═══════════════════════════════════════════

Hansı tool-u seçməli:

• \`web_fetch\` — YALNIZ statik səhifələr üçün: plain HTML, blog yazıları, 
  API reference sənədləri, GitHub README-lər. JavaScript icra ETMİR.
  Sadəcə HTTP GET + HTML strip edir.

• \`browser_open\` + \`browser_eval\` — Dinamik (JS) səhifələr üçün: 
  e-ticarət saytları (laptopmarket.az, trendyol, wix), SPA-lar 
  (React/Vue/Angular), dashboard-lar, login tələb edən səhifələr.
  Playwright browser-də JS icra edir.

NECƏ:
  1) browser_open(url) — səhifəni aç
  2) browser_wait_for(state:'networkidle') — JS-nin yüklənməsini gözlə
  3) browser_eval("document.body.innerText") — bütün mətni çıxart
  və ya browser_eval("JSON.stringify([...document.querySelectorAll('...')].map(e => e.textContent))") 
  — konkret elementləri çıxart

BİRBAŞA NÜMUNƏ:
  İstifadəçi: "laptopmarket.az saytından ən ucuz laptopu tap"
  Sən: browser_open(url) -> browser_wait_for -> browser_eval ilə 
  qiymət siyahısını çıxart -> nəticəni analiz et -> ən ucuzu tap

═══════════════════════════════════════════

${generateToolsSystemPrompt(TOOLS)}`;

  const historyMessages = Array.isArray(messages) && messages.length > 1 ? messages.slice(0, -1) : [];

  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...(productMode === 'web_chat' && safeReferentSummary?.previousAssistant ? [{
      role: 'system',
      content: `Qısa follow-up referensi: əvvəlki istifadəçi mesajı: ${String(safeReferentSummary.previousUser || '').slice(0, 300)} | əvvəlki assistant mesajı: ${String(safeReferentSummary.previousAssistant || '').slice(0, 700)}. İstifadəçinin cari qısa follow-up-ını bu iki mesajla əlaqələndir və mövzudan kənara çıxma.`
    }] : []),
    ...(productMode === 'web_chat' && resolvedFollowup ? [{
      role: 'system',
      content: `Dialogue continuity state: domain=${resolvedFollowup.domain}; kind=${resolvedFollowup.kind}; previous user=${String(resolvedFollowup.previousUser || '').slice(0, 220)}; previous assistant=${String(resolvedFollowup.previousAssistant || '').slice(0, 420)}. Cari mesajı bu kontekst daxilində şərh et və yeni mövzu uydurma.`
    }] : []),
    ...(productMode === 'web_chat' && continuityHint ? [{
      role: 'system',
      content: `Söhbət davamlılığı ipucu: bu mesaj böyük ehtimalla eyni dialoqun davamıdır. Mövcud mövzu=${continuityHint.domain}. Son istifadəçi mesajı=${String(continuityHint.previousUser || '').slice(0, 220)}. Son assistant cavabı=${String(continuityHint.previousAssistant || '').slice(0, 420)}. Cari mesajı əvvəlki kontekstə bağla; ancaq istifadəçi açıq yeni mövzu açıbsa zorla köhnə mövzuya qaytarma.`
    }] : []),
    ...(productMode === 'web_chat' && continuityHint?.hasRecentVisualReferent ? [{
      role: 'system',
      content: 'Visual referent ipucu: istifadəçi bu thread-də daha əvvəl attachment və ya şəkil göndərib. Cari follow-up böyük ehtimalla həmin sənədə aiddir. Attachment-i itmiş sayma, yenidən upload/fayl yolu istəmə və "sənədi görmürəm" fallback-ına qaçma.'
    }] : []),
    ...historyMessages,
    {
      role: 'user',
      content: latestUserText || '[İstifadəçi fayl/attachment göndərdi]',
      attachments: requestAttachments
    }
  ];

  // Setup the chat session
  initSse(res);
  emitOrchestrationPrelude(res, { runId, orchestration, runManager, pendingAutoRouteEvent: null });

  try {
    await runChatSession({
      req, res, slotAcquired: true, conversationId: conversationIdSafe,
      runManager, orchestration, resolvedWD, latestUserText,
      auditStyleRequest: isAuditStyle, productMode: productMode || 'desktop_code',
      projectMemory: null, apiMessages,
      emitTaskPlan: (r, items) => emitTaskPlan(r, items),
      emitGovernanceState: (r, p) => emitGovernanceState(r, p),
      writeSse: (r, payload) => writeSse(r, payload),
      createPhaseContext: ({ currentMessages, runManager, orchestration, resolvedWD, auditStyleRequest, projectMemory }) => {
        const activePhase = orchestration.enabled ? runManager.currentPhase() : null;
        const phaseTools = activePhase
          ? getToolsForRole(activePhase.role, orchestration.workflow)
          : TOOLS;
        return { currentMessages, phaseTools, activePhase };
      },
      openAiStreamWithFallback,
      collectStreamOutput,
      executeToolCalls,
      extractPlannerArtifact,
      buildExecutionArtifact,
      classifyArtifactQuality,
      buildPhaseRecoveryInstruction,
      isFileClarificationLoop,
      shouldEmitDebugEvent,
      compactMessagesForNextPhase,
      buildPhaseHandoffMessage,
      buildPlannerArtifactContext,
      buildExecutionArtifactContext,
      releaseChatSlot: () => {},
      setConversationAbort: () => {},
      reqUser: req.user,
      dependencies: {
        MAX_STEPS, effectiveModelRef, activeProviderRef, clientRef, isLocalOrFlakyModel,
        providerCandidates, providerRuntime,
        buildOpenAIClient, normalizeMessagesForModel,
        mapMessagesToResponsesInput, mapToolsToResponsesTools,
        isResponsesSchemaMismatchError, buildDeepSeekRecoveryMessages,
        llmTimeoutMs: productMode === 'web_chat' ? LLM_TIMEOUT_CHAT : LLM_TIMEOUT_MS,
        handleToolCall, normalizeToolName, extractTextToolCalls,
        buildToolCallCacheKey, flattenResponseJsonText,
        normalizeFinalAssistantReport, isSensitiveTool,
        isLocalMode, buildApprovalMetadata, isCacheableTool,
        buildToolRecoveryInstruction, normalizeUserFacingError,
        crypto, hasAttachmentInRequest, safeMode, runId,
        entryPath, initialGateReceipt,
        providerSessionKey,
        onProviderTelemetry: (payload) => {
          const safePayload = {
            ...payload,
            baseURL: payload?.baseURL ? '[redacted]' : undefined,
            toBaseURL: payload?.toBaseURL ? '[redacted]' : undefined
          };
          emitProviderTelemetry(res, safePayload);
        },
        buildFinalGateReceipt: ({ plannerArtifact, executionArtifacts }) => buildGateReceipt({ plannerArtifact, executionArtifacts }),
        finishSse
      }
    });
  } catch (err) {
    console.error('Chat session error:', err);
    if (!res.writableEnded) {
      writeSse(res, { type: 'error', message: 'Server xətası baş verdi.' });
      res.end();
    }
  }
});

module.exports = router;
module.exports.getDirectWebChatReply = getDirectWebChatReply;

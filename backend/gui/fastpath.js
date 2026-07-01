const crypto = require('crypto');

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function initSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function emitOrchestrationPrelude(res, orchestration, runManager, runId) {
  writeSse(res, {
    type: 'orchestration_state',
    runId,
    workflow: orchestration.workflow,
    mode: orchestration.mode,
    agents: orchestration.agents,
    routing: orchestration.routing
  });
  if (orchestration.enabled) {
    writeSse(res, {
      type: 'orchestration_phase',
      ...runManager.snapshot()
    });
  }
}

async function handleGuiLoginResume({
  res,
  orchestration,
  runManager,
  resolvedWD,
  reqUser,
  checkpoint,
  latestUserText,
  handleToolCall,
  normalizeUserFacingError
}) {
  const runId = crypto.randomUUID();
  initSse(res);
  emitOrchestrationPrelude(res, orchestration, runManager, runId);

  const sessionId = checkpoint?.sessionId || 'gui-wix-live';
  const isSeoGui = orchestration?.workflow === 'seo_gui' || checkpoint?.workflow === 'seo_gui';
  const goal = String(latestUserText || '').trim() || (
    isSeoGui
      ? 'Observe the Wix dashboard after login, identify SEO/Marketing settings, and report the next safe SEO audit step. Do not save or publish anything.'
      : 'Observe the Wix dashboard after login and identify the next safe step toward SEO settings. Do not save or publish anything.'
  );

  const toolCall = {
    id: `call_${crypto.randomUUID()}`,
    type: 'function',
    function: {
      name: 'gui_observe',
      arguments: JSON.stringify({
        sessionId,
        goal,
        history: []
      })
    }
  };

  writeSse(res, {
    type: 'assistant_message',
    message: {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: isSeoGui
        ? 'Login sonrası Wix pəncərəsini SEO audit üçün yalnız müşahidə edirəm. Heç nə publish/save edilməyəcək.'
        : 'Login sonrası Wix pəncərəsini yalnız müşahidə edirəm. Heç nə publish/save edilməyəcək.',
      tool_calls: [toolCall]
    }
  });
  writeSse(res, { type: 'tool_execution', tool: toolCall.function.name, args: toolCall.function.arguments, tool_call_id: toolCall.id });
  const result = await handleToolCall(toolCall, resolvedWD, reqUser);
  writeSse(res, { type: 'tool_result', result: normalizeUserFacingError(result) });
  writeSse(res, {
    type: 'assistant_message',
    message: {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: isSeoGui
        ? 'Növbəti təhlükəsiz SEO addımı: Wix dashboard-da sol menyuda SEO, Marketing və ya Settings bölməsinin görünüb-görünmədiyini təsdiqlə. Hələ heç nə save/publish etmə; əvvəl observation əsasında SEO audit üçün düzgün giriş nöqtəsini müəyyənləşdirmək lazımdır.'
        : 'Növbəti təhlükəsiz addım: Wix dashboard-da sayt kartını və ya sol menyunu vizual yoxla, SEO/Marketing bölməsinə keçid olub-olmadığını təsdiqlə. Hələ heç nə klikləməyi, save və publish etməyi tövsiyə etmirəm; əvvəl screenshot/observation əsasında konkret selector və səhifə vəziyyətini dəqiqləşdirmək lazımdır.'
    }
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

async function handleGuiLoginCheckpointAction({
  res,
  checkpoint,
  orchestration,
  runManager,
  resolvedWD,
  reqUser,
  handleToolCall,
  normalizeUserFacingError
}) {
  if (!checkpoint || checkpoint.kind !== 'login') {
    res.status(404).json({ error: 'Checkpoint tapılmadı' });
    return;
  }

  if (checkpoint.decision !== 'resume') {
    return res.json({ success: true, status: 'cancelled' });
  }

  return handleGuiLoginResume({
    res,
    orchestration,
    runManager,
    resolvedWD,
    reqUser,
    checkpoint,
    handleToolCall,
    normalizeUserFacingError
  });
}

async function handleGuiLoginCheckpoint({
  res,
  orchestration,
  runManager,
  resolvedWD,
  conversationId,
  reqUser,
  handleToolCall,
  normalizeUserFacingError,
  browserOpenArgs,
  createCheckpoint
}) {
  const runId = crypto.randomUUID();
  initSse(res);
  emitOrchestrationPrelude(res, orchestration, runManager, runId);

  const isSeoGui = orchestration?.workflow === 'seo_gui';
  const sessionId = isSeoGui ? 'seo-gui-wix-live' : 'gui-wix-live';
  const checkpointTitle = isSeoGui ? 'Wix SEO login checkpoint' : 'Wix login checkpoint';
  const checkpointMessage = isSeoGui
    ? 'Açılan Chrome pəncərəsində Wix hesabına daxil olun. Login bitəndə “Login oldum” düyməsini basın; sonra SEO audit müşahidəsi davam edəcək.'
    : 'Açılan Chrome pəncərəsində Wix hesabına daxil olun. Login bitəndə “Login oldum” düyməsini basın.';
  const resumePrompt = isSeoGui
    ? 'login oldum. İndi yalnız observe et, Wix dashboard-da SEO və ya Marketing bölməsinə gedən növbəti təhlükəsiz addımı de və SEO audit üçün ilkin findings çıxar. Heç nə publish etmə, heç nə save etmə. Workflow: seo_gui.'
    : 'login oldum. İndi yalnız observe et və Wix dashboard-da SEO settings-ə getmək üçün növbəti təhlükəsiz addımı de. Heç nə publish etmə, heç nə save etmə. Workflow: gui.';

  const toolCall = {
    id: `call_${crypto.randomUUID()}`,
    type: 'function',
    function: {
      name: 'browser_open',
      arguments: JSON.stringify(browserOpenArgs)
    }
  };

  writeSse(res, {
    type: 'assistant_message',
    message: {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: isSeoGui
        ? 'Visible Chrome açılır və wix.com yüklənir. SEO audit üçün login checkpoint-i göstəriləcək; agent gözləmə rejimində açıq qalmayacaq.'
        : 'Visible Chrome açılır və wix.com yüklənir. Login üçün insan checkpoint-i göstəriləcək; agent gözləmə rejimində açıq qalmayacaq.',
      tool_calls: [toolCall]
    }
  });
  writeSse(res, { type: 'tool_execution', tool: toolCall.function.name, args: toolCall.function.arguments, tool_call_id: toolCall.id });
  const result = await handleToolCall(toolCall, resolvedWD, reqUser);
  const normalized = String(normalizeUserFacingError(result) || '');
  writeSse(res, { type: 'tool_result', result: normalized });

  const openedSuccessfully = /^Browser opened:/i.test(String(result || '').trim());
  const definitelyFailed = /^Browser open error:/i.test(String(result || '').trim()) ||
    /(^|\n)(API xətası|Tool xətası|xəta|failed|unable|not found|could not)/i.test(normalized);

  if (!openedSuccessfully && definitelyFailed) {
    writeSse(res, {
      type: 'assistant_message',
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Browser açıla bilmədi və ya Wix yüklənmədi. Ona görə login checkpoint-ə keçmədim. Əvvəl browser launch problemini həll etmək lazımdır.'
      }
    });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  const checkpointId = crypto.randomUUID();
  const expiresAt = Date.now() + 300000;
  createCheckpoint(checkpointId, {
    userId: reqUser?.id,
    kind: 'login',
    workflow: isSeoGui ? 'seo_gui' : 'gui',
    sessionId,
    title: checkpointTitle,
    message: checkpointMessage,
    resumePrompt,
    cancelPrompt: 'hələ login olmamışam, gözləyək.',
    resumeLabel: 'Login oldum',
    cancelLabel: 'Hələ yox',
    conversationId,
    runId,
    phaseRole: runManager?.currentPhase?.()?.role || 'Planner',
    expiresAt
  });

  writeSse(res, {
    type: 'human_checkpoint',
    checkpoint: {
      id: checkpointId,
      kind: 'login',
      workflow: isSeoGui ? 'seo_gui' : 'gui',
      sessionId,
      conversationId,
      runId,
      phaseRole: runManager?.currentPhase?.()?.role || 'Planner',
      expiresAt,
      title: checkpointTitle,
      message: checkpointMessage,
      resumePrompt,
      cancelPrompt: 'hələ login olmamışam, gözləyək.',
      resumeLabel: 'Login oldum',
      cancelLabel: 'Hələ yox'
    }
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

async function handleGuiSelfTest({
  res,
  orchestration,
  runManager,
  resolvedWD,
  reqUser,
  handleToolCall,
  normalizeUserFacingError,
  browserOpenArgs
}) {
  const runId = crypto.randomUUID();
  initSse(res);
  emitOrchestrationPrelude(res, orchestration, runManager, runId);

  const toolCalls = [
    {
      id: `call_${crypto.randomUUID()}`,
      type: 'function',
      function: {
        name: 'browser_open',
        arguments: JSON.stringify(browserOpenArgs)
      }
    },
    {
      id: `call_${crypto.randomUUID()}`,
      type: 'function',
      function: {
        name: 'gui_observe',
        arguments: JSON.stringify({
          sessionId: 'gui-self-test',
          goal: 'Observe example.com and capture a screenshot without risky actions.',
          history: []
        })
      }
    },
    {
      id: `call_${crypto.randomUUID()}`,
      type: 'function',
      function: {
        name: 'gui_step',
        arguments: JSON.stringify({
          sessionId: 'gui-self-test',
          goal: 'Observe example.com and capture a screenshot without risky actions.',
          autoGround: false,
          groundingMode: 'prompt_only',
          minConfidence: 0.35,
          history: []
        })
      }
    }
  ];

  writeSse(res, {
    type: 'assistant_message',
    message: {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'GUI self-test başlayır: visible browser açılır, observation və prompt-only GUI step icra olunur. AI provider çağırılmayacaq və riskli action edilməyəcək.',
      tool_calls: toolCalls
    }
  });

  for (const toolCall of toolCalls) {
    writeSse(res, { type: 'tool_execution', tool: toolCall.function.name, args: toolCall.function.arguments, tool_call_id: toolCall.id });
    const result = await handleToolCall(toolCall, resolvedWD, reqUser);
    writeSse(res, { type: 'tool_result', result: normalizeUserFacingError(result) });
  }

  writeSse(res, {
    type: 'assistant_message',
    message: {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'GUI self-test tamamlandı. Açılan browser pəncərəsini canlı görməli idin; Tool card-larda screenshot və GUI Decision paneli də görünməlidir.'
    }
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

module.exports = {
  handleGuiLoginResume,
  handleGuiLoginCheckpointAction,
  handleGuiLoginCheckpoint,
  handleGuiSelfTest
};

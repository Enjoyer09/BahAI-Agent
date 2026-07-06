const crypto = require('crypto');
const { appendGuiRepairGuidance } = require('./repairGuidance');
const { openUrl, openApp, takeScreenshot } = require('./screen-agent');

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
    const guidance = normalized && normalized !== String(result || '').trim()
      ? `\n\nSəbəb: ${appendGuiRepairGuidance(normalized)}`
      : '';
    writeSse(res, {
      type: 'assistant_message',
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Browser açıla bilmədi və ya Wix yüklənmədi. Ona görə login checkpoint-ə keçmədim. Əvvəl browser launch problemini həll etmək lazımdır.${guidance}`
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

async function handleGuiOpenAndAwaitInstruction({
  res,
  orchestration,
  runManager,
  resolvedWD,
  reqUser,
  handleToolCall,
  normalizeUserFacingError,
  browserOpenArgs,
  promptText = ''
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
          sessionId: browserOpenArgs.sessionId || 'gui-live',
          goal: String(promptText || 'Open the requested website and observe the current page state.'),
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
      content: 'Saytı visible browser-də açır və cari vəziyyəti qısa müşahidə edirəm. Sonra dayanıb növbəti addımı sizdən soruşacağam.',
      tool_calls: toolCalls
    }
  });

  let browserOpenRaw = '';
  let browserFailed = false;
  for (let index = 0; index < toolCalls.length; index += 1) {
    const toolCall = toolCalls[index];
    writeSse(res, { type: 'tool_execution', tool: toolCall.function.name, args: toolCall.function.arguments, tool_call_id: toolCall.id });
    let result = await handleToolCall(toolCall, resolvedWD, reqUser);
    const normalized = normalizeUserFacingError(result);
    writeSse(res, { type: 'tool_result', result: normalized });
    if (toolCall.function.name === 'browser_open') {
      browserOpenRaw = String(result || '');
      browserFailed = /^Browser open error:/i.test(browserOpenRaw.trim());
      if (browserFailed && /cdp_unreachable/i.test(browserOpenRaw) && browserOpenArgs?.url) {
        const retryToolCall = {
          id: `call_${crypto.randomUUID()}`,
          type: 'function',
          function: {
            name: 'browser_open',
            arguments: JSON.stringify({
              ...browserOpenArgs,
              cdpUrl: undefined,
              browserChannel: 'chrome',
              executablePath: browserOpenArgs.executablePath,
              persistent: true
            })
          }
        };
        writeSse(res, { type: 'tool_execution', tool: retryToolCall.function.name, args: retryToolCall.function.arguments, tool_call_id: retryToolCall.id });
        result = await handleToolCall(retryToolCall, resolvedWD, reqUser);
        const retryNormalized = normalizeUserFacingError(result);
        writeSse(res, { type: 'tool_result', result: retryNormalized });
        browserOpenRaw = String(result || '');
        browserFailed = /^Browser open error:/i.test(browserOpenRaw.trim());
      }
      if (browserFailed) break;
    }
  }

  if (browserFailed) {
    writeSse(res, {
      type: 'assistant_message',
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Saytı aça bilmədim.\n\n${appendGuiRepairGuidance(normalizeUserFacingError(browserOpenRaw))}`
      }
    });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  writeSse(res, {
    type: 'assistant_message',
    message: {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'Sayt açıldı və sessiya aktivdir. İndi başqa nə etməyimi istəyirsiniz? Məsələn: məhsul axtarım, filter tətbiq edim, qiymət müqayisəsi edim, yoxsa konkret bir məhsul səhifəsinə keçim?'
    }
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

async function handleGuiContinuation({
  res,
  orchestration,
  runManager,
  resolvedWD,
  reqUser,
  handleToolCall,
  normalizeUserFacingError,
  sessionId = 'gui-live',
  promptText = ''
}) {
  const runId = crypto.randomUUID();
  initSse(res);
  emitOrchestrationPrelude(res, orchestration, runManager, runId);

  const searchText = String(promptText || '').trim();
  const toolCalls = [
    {
      id: `call_${crypto.randomUUID()}`,
      type: 'function',
      function: {
        name: 'browser_press',
        arguments: JSON.stringify({
          sessionId,
          key: 'Meta+L'
        })
      }
    },
    {
      id: `call_${crypto.randomUUID()}`,
      type: 'function',
      function: {
        name: 'browser_type',
        arguments: JSON.stringify({
          sessionId,
          selector: 'body',
          text: searchText
        })
      }
    },
    {
      id: `call_${crypto.randomUUID()}`,
      type: 'function',
      function: {
        name: 'browser_press',
        arguments: JSON.stringify({
          sessionId,
          key: 'Enter'
        })
      }
    },
    {
      id: `call_${crypto.randomUUID()}`,
      type: 'function',
      function: {
        name: 'gui_observe',
        arguments: JSON.stringify({
          sessionId,
          goal: `Continue the current browser task after this user instruction: ${searchText}`,
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
      content: 'Aktiv browser sessiyasında davam edirəm. Verilən əmri tətbiq edib nəticəni qısa müşahidə edəcəyəm.',
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
      content: 'Əməliyyat icra olundu və eyni browser sessiyası açıq qalır. İstəsən növbəti addımı da bu sessiyada davam etdirə bilərəm.'
    }
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

async function handleComputerUseOpenAndAwait({
  res,
  orchestration,
  runManager,
  target,
  promptText = ''
}) {
  const runId = crypto.randomUUID();
  initSse(res);
  emitOrchestrationPrelude(res, orchestration, runManager, runId);

  try {
    let result;
    if (target?.type === 'url') {
      result = await openUrl(target.value);
    } else {
      result = await openApp(target?.value || 'Finder');
    }
    const screenshot = await takeScreenshot();

    writeSse(res, {
      type: 'assistant_message',
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Computer Use ilə ${target?.type === 'url' ? 'URL açdım' : 'app açdım'} və cari vəziyyəti müşahidə etdim. İndi növbəti addımı sizdən gözləyirəm.`,
      }
    });
    writeSse(res, {
      type: 'tool_result',
      result: JSON.stringify({
        observation: {
          title: target?.value || '',
          url: target?.type === 'url' ? target.value : '',
          screenshotPath: screenshot.path
        },
        action: result
      })
    });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    writeSse(res, {
      type: 'assistant_message',
      message: {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Computer Use açılışı alınmadı: ${error.message || error}`
      }
    });
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

async function handleComputerUseContinuation({
  res,
  orchestration,
  runManager,
  promptText = ''
}) {
  const runId = crypto.randomUUID();
  initSse(res);
  emitOrchestrationPrelude(res, orchestration, runManager, runId);

  const lower = String(promptText || '').toLowerCase();
  const inferredAction = lower.includes('scroll')
    ? { type: 'scroll', amount: -4 }
    : lower.includes('enter') || lower.includes('bas')
      ? { type: 'press', key: 'enter' }
      : lower.includes('yaz') || lower.includes('type')
        ? { type: 'type', text: String(promptText || '').replace(/^.*?(yaz|type)\s*/i, '').trim() || String(promptText || '').trim() }
        : { type: 'screenshot' };

  let actionResult = null;
  try {
    const { executeComputerUseAction } = require('./computerUseActions');
    actionResult = await executeComputerUseAction(inferredAction);
  } catch {
    actionResult = null;
  }
  const screenshot = await takeScreenshot().catch(() => null);
  writeSse(res, {
    type: 'assistant_message',
    message: {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: `Computer Use sessiyası aktivdir. Davam əmrinə uyğun addımı tətbiq etdim və hazırkı desktop vəziyyətini yenidən müşahidə etdim.`
    }
  });
  if (screenshot?.path || actionResult) {
    writeSse(res, {
      type: 'tool_result',
      result: JSON.stringify({
        action: actionResult?.action || inferredAction,
        observation: {
          screenshotPath: screenshot.path
        }
      })
    });
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

module.exports = {
  handleGuiLoginResume,
  handleGuiLoginCheckpointAction,
  handleGuiLoginCheckpoint,
  handleGuiSelfTest,
  handleGuiOpenAndAwaitInstruction,
  handleGuiContinuation,
  handleComputerUseOpenAndAwait,
  handleComputerUseContinuation
};

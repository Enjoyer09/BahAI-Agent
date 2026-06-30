const { groundElement, reflectOnAction } = require('./grounding');

function buildGuiGroundingPrompt({ goal = '', observation = {}, history = [] }) {
  return {
    goal,
    observation,
    history: Array.isArray(history) ? history.slice(-8) : [],
    instruction: `You are a GUI automation agent. Analyze the screenshot and return the next action as JSON.

Available action types:
- click_xy: Click at coordinates {type:"click_xy", x:number, y:number, description:"what you clicked"}
- click_element: Click element by description {type:"click_element", description:"natural language description"}
- type: Type text {type:"type", x:number, y:number, text:"...", overwrite:bool, enter:bool}
- press: Press key {type:"press", key:"Enter|Tab|Escape|..."}
- hotkey: Key combo {type:"hotkey", keys:["ctrl","c"]}
- scroll: Scroll {type:"scroll", target_x:number, target_y:number, y:number(positive=down)}
- wait: Wait {type:"wait", ms:number}
- navigate: Go to URL {type:"navigate", url:"https://..."}
- done: Task complete {type:"done"}

Prefer click_element or click_xy over CSS selectors. Include confidence (0-1) and reasoning.`
  };
}

const ALLOWED_GUI_ACTIONS = new Set(['click', 'click_xy', 'click_element', 'type', 'press', 'hotkey', 'scroll', 'wait', 'navigate', 'done']);

function normalizeGuiActionCandidate(raw = {}) {
  return {
    type: String(raw.type || '').trim(),
    selector: raw.selector ? String(raw.selector) : '',
    description: raw.description ? String(raw.description) : '',
    text: raw.text ? String(raw.text) : '',
    key: raw.key ? String(raw.key) : '',
    keys: raw.keys || undefined,
    url: raw.url ? String(raw.url) : '',
    x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : undefined,
    y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : undefined,
    target_x: raw.target_x != null ? Number(raw.target_x) : undefined,
    target_y: raw.target_y != null ? Number(raw.target_y) : undefined,
    clicks: raw.clicks ? Number(raw.clicks) : undefined,
    button: raw.button ? String(raw.button) : undefined,
    overwrite: Boolean(raw.overwrite),
    enter: Boolean(raw.enter),
    ms: raw.ms ? Number(raw.ms) : undefined,
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : undefined,
    reasoning: raw.reasoning ? String(raw.reasoning) : ''
  };
}

function assessGuiAction(action = {}, { minConfidence = 0.35 } = {}) {
  const normalized = normalizeGuiActionCandidate(action);
  const confidence = Number.isFinite(Number(normalized.confidence)) ? Number(normalized.confidence) : undefined;

  if (!ALLOWED_GUI_ACTIONS.has(normalized.type)) {
    return {
      executable: false,
      action: normalized,
      reason: `Unsupported GUI action type: ${normalized.type || 'empty'}`
    };
  }

  if (confidence !== undefined && confidence < minConfidence) {
    return {
      executable: false,
      action: normalized,
      reason: `GUI action confidence ${confidence} is below threshold ${minConfidence}`
    };
  }

  // click_element only needs a description
  if (normalized.type === 'click_element' && !normalized.description) {
    return {
      executable: false,
      action: normalized,
      reason: 'click_element requires a description'
    };
  }

  // click_xy needs coordinates
  if (normalized.type === 'click_xy' && (normalized.x == null || normalized.y == null)) {
    return {
      executable: false,
      action: normalized,
      reason: 'click_xy requires x and y coordinates'
    };
  }

  // Original click needs selector or coordinates
  if (normalized.type === 'click' && !normalized.selector && normalized.x == null) {
    return {
      executable: false,
      action: normalized,
      reason: 'click requires a selector or x,y coordinates'
    };
  }

  if (normalized.type === 'type' && !normalized.text) {
    return {
      executable: false,
      action: normalized,
      reason: 'type requires non-empty text'
    };
  }

  if (normalized.type === 'press' && !normalized.key) {
    return {
      executable: false,
      action: normalized,
      reason: 'press requires a key'
    };
  }

  if (normalized.type === 'navigate' && !normalized.url) {
    return {
      executable: false,
      action: normalized,
      reason: 'navigate requires a url'
    };
  }

  return {
    executable: true,
    action: normalized,
    reason: 'Action passed GUI safety checks'
  };
}

function buildGuiReflection({ goal = '', action = {}, result = {}, observation = {}, screenshotBefore = null, screenshotAfter = null }) {
  const success = Boolean(result?.ok) && !/unknown|error/i.test(String(result?.summary || ''));
  return {
    goal,
    success,
    action,
    result,
    observation,
    screenshotBefore,
    screenshotAfter,
    nextRecommendation: success
      ? 'Continue toward the goal with the next grounded action.'
      : 'Retry with a different element, coordinate, or interaction strategy.'
  };
}

function buildGuiGroundingMessages({ goal = '', observation = {}, history = [] }) {
  const prompt = buildGuiGroundingPrompt({ goal, observation, history });
  const messages = [
    {
      role: 'system',
      content: prompt.instruction
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Goal: ${goal}\n\nPage: ${observation.title || ''} (${observation.url || ''})\n\nHistory:\n${history.slice(-3).map((h, i) => `${i + 1}. ${h.action?.type || ''}: ${h.result?.summary || ''}`).join('\n')}\n\nWhat is the next action?`
        }
      ]
    }
  ];

  // Add screenshot if available
  if (observation.screenshotBase64) {
    messages[1].content = [
      ...messages[1].content,
      {
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${observation.screenshotBase64}`,
          detail: 'high'
        }
      }
    ];
  }

  return messages;
}

async function resolveGroundedAction({ client, model, goal = '', observation = {}, history = [], minConfidence = 0.35 }) {
  if (!client || !model) {
    const action = normalizeGuiActionCandidate({
      type: 'wait',
      ms: 2000,
      confidence: 0.15,
      reasoning: 'Fallback: no model client configured.'
    });
    return {
      ...assessGuiAction(action, { minConfidence }),
      source: 'fallback'
    };
  }

  try {
    const messages = buildGuiGroundingMessages({ goal, observation, history });
    const response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    });
    const text = response.choices?.[0]?.message?.content || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    const action = normalizeGuiActionCandidate(parsed);
    return {
      ...assessGuiAction(action, { minConfidence }),
      source: 'provider'
    };
  } catch (err) {
    console.error('[GUI Provider] Grounding failed:', err.message);
    const action = normalizeGuiActionCandidate({
      type: 'wait',
      ms: 2000,
      confidence: 0.15,
      reasoning: `Fallback: grounding failed — ${err.message}`
    });
    return {
      ...assessGuiAction(action, { minConfidence }),
      source: 'fallback'
    };
  }
}

module.exports = {
  ALLOWED_GUI_ACTIONS,
  buildGuiGroundingPrompt,
  normalizeGuiActionCandidate,
  assessGuiAction,
  buildGuiReflection,
  buildGuiGroundingMessages,
  resolveGroundedAction
};

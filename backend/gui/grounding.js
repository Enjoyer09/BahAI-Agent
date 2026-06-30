// ==========================================
// GUI Visual Grounding — Agent-S Style
// Inspired by simular-ai/Agent-S (ICLR 2025)
//
// Uses a multimodal LLM (vision model) to locate UI elements
// by natural language description on a screenshot.
// Falls back to OCR-based text matching when grounding model unavailable.
// ==========================================

const { createWorker } = require('tesseract.js');
const { OpenAI } = require('openai');
const fs = require('fs/promises');
const path = require('path');

let ocrWorker = null;

/**
 * Get or create a shared OCR worker (tesseract.js)
 */
async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = await createWorker('eng');
  }
  return ocrWorker;
}

/**
 * Visual Grounding — find element coordinates from a natural language description.
 * Uses a vision-capable LLM (GPT-4o, Claude, etc.) to look at the screenshot
 * and return pixel coordinates of the described element.
 *
 * Inspired by Agent-S's generate_coords() which uses UI-TARS-1.5-7B.
 *
 * @param {Object} options
 * @param {Buffer|string} options.screenshot - Screenshot as buffer or base64
 * @param {string} options.description - Natural language description of the target element
 * @param {Object} [options.engineParams] - LLM config {apiKey, baseURL, model}
 * @returns {Promise<{x: number, y: number, confidence: number, method: string}>}
 */
async function visualGround({ screenshot, description, engineParams = {} }) {
  const {
    apiKey = process.env.GROUNDING_API_KEY || process.env.OPENAI_API_KEY,
    baseURL = process.env.GROUNDING_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.freemodel.dev/v1',
    model = process.env.GROUNDING_MODEL || 'gpt-5.5'
  } = engineParams;

  if (!apiKey || apiKey === 'ollama') {
    // No vision model available — fall back to OCR
    return null;
  }

  const base64 = Buffer.isBuffer(screenshot)
    ? screenshot.toString('base64')
    : screenshot;

  const client = new OpenAI({ apiKey, baseURL });

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a UI element grounding model. Given a screenshot and a description of a UI element, output ONLY the pixel coordinates of that element's center as "x,y" (two integers separated by comma). Nothing else.`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Find the element: "${description}"\nOutput only coordinates as: x,y`
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64}`,
                detail: 'high'
              }
            }
          ]
        }
      ],
      temperature: 0.0,
      max_tokens: 50
    });

    const text = response.choices?.[0]?.message?.content || '';
    const numbers = text.match(/\d+/g);
    if (numbers && numbers.length >= 2) {
      return {
        x: parseInt(numbers[0]),
        y: parseInt(numbers[1]),
        confidence: 0.85,
        method: 'visual_grounding'
      };
    }
  } catch (err) {
    console.error('[GUI Grounding] Visual grounding failed:', err.message);
  }

  return null;
}

/**
 * OCR-based Text Grounding — find text on screen and return its coordinates.
 * Inspired by Agent-S's generate_text_coords() using pytesseract.
 *
 * @param {Object} options
 * @param {Buffer|string} options.screenshot - Screenshot as buffer or path
 * @param {string} options.phrase - Text phrase to find
 * @param {'start'|'end'|'center'} [options.alignment='center'] - Which part of the text to target
 * @returns {Promise<{x: number, y: number, confidence: number, method: string, matchedText: string}|null>}
 */
async function ocrTextGround({ screenshot, phrase, alignment = 'center' }) {
  const worker = await getOcrWorker();

  let imageInput = screenshot;
  if (typeof screenshot === 'string' && !screenshot.startsWith('/')) {
    // base64 → buffer
    imageInput = Buffer.from(screenshot, 'base64');
  }

  const { data } = await worker.recognize(imageInput);
  const words = data.words || [];

  if (words.length === 0) return null;

  // Strategy 1: exact phrase match across consecutive words
  const phraseLower = phrase.toLowerCase().trim();
  const phraseWords = phraseLower.split(/\s+/);

  for (let i = 0; i <= words.length - phraseWords.length; i++) {
    let match = true;
    for (let j = 0; j < phraseWords.length; j++) {
      if (!words[i + j].text.toLowerCase().includes(phraseWords[j])) {
        match = false;
        break;
      }
    }
    if (match) {
      const startWord = words[i];
      const endWord = words[i + phraseWords.length - 1];

      let x, y;
      if (alignment === 'start') {
        x = startWord.bbox.x0;
        y = startWord.bbox.y0 + (startWord.bbox.y1 - startWord.bbox.y0) / 2;
      } else if (alignment === 'end') {
        x = endWord.bbox.x1;
        y = endWord.bbox.y0 + (endWord.bbox.y1 - endWord.bbox.y0) / 2;
      } else {
        // center of the whole phrase bounding box
        x = (startWord.bbox.x0 + endWord.bbox.x1) / 2;
        y = (startWord.bbox.y0 + endWord.bbox.y1) / 2;
      }

      return {
        x: Math.round(x),
        y: Math.round(y),
        confidence: 0.75,
        method: 'ocr_text_grounding',
        matchedText: words.slice(i, i + phraseWords.length).map(w => w.text).join(' ')
      };
    }
  }

  // Strategy 2: fuzzy single-word match (best partial)
  let bestMatch = null;
  let bestScore = 0;

  for (const word of words) {
    const wordLower = word.text.toLowerCase();
    if (wordLower.includes(phraseLower) || phraseLower.includes(wordLower)) {
      const score = Math.min(wordLower.length, phraseLower.length) / Math.max(wordLower.length, phraseLower.length);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = word;
      }
    }
  }

  if (bestMatch && bestScore > 0.5) {
    return {
      x: Math.round((bestMatch.bbox.x0 + bestMatch.bbox.x1) / 2),
      y: Math.round((bestMatch.bbox.y0 + bestMatch.bbox.y1) / 2),
      confidence: bestScore * 0.7,
      method: 'ocr_fuzzy_match',
      matchedText: bestMatch.text
    };
  }

  return null;
}

/**
 * Unified grounding: try visual model first, fall back to OCR.
 * This is the main entry point for GUI element location.
 *
 * @param {Object} options
 * @param {Buffer|string} options.screenshot
 * @param {string} options.description - what to find
 * @param {Object} [options.engineParams] - vision model config
 * @returns {Promise<{x: number, y: number, confidence: number, method: string}>}
 */
async function groundElement({ screenshot, description, engineParams = {} }) {
  // Try visual grounding first (requires vision-capable model)
  const visualResult = await visualGround({ screenshot, description, engineParams });
  if (visualResult) return visualResult;

  // Fall back to OCR text grounding
  const ocrResult = await ocrTextGround({ screenshot, phrase: description });
  if (ocrResult) return ocrResult;

  // Last resort: return center of screen
  return {
    x: 960,
    y: 540,
    confidence: 0.1,
    method: 'fallback_center'
  };
}

/**
 * Reflection — compare before/after screenshots to assess action success.
 * Inspired by Agent-S's reflection agent.
 *
 * @param {Object} options
 * @param {string} options.goal - What we're trying to achieve
 * @param {string} options.lastAction - Description of last action taken
 * @param {Buffer|string} options.screenshotBefore - Screenshot before action
 * @param {Buffer|string} options.screenshotAfter - Screenshot after action
 * @param {Object} [options.engineParams] - LLM config
 * @returns {Promise<{success: boolean, assessment: string, nextStep: string}>}
 */
async function reflectOnAction({ goal, lastAction, screenshotBefore, screenshotAfter, engineParams = {} }) {
  const {
    apiKey = process.env.GROUNDING_API_KEY || process.env.OPENAI_API_KEY,
    baseURL = process.env.GROUNDING_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.freemodel.dev/v1',
    model = process.env.REFLECTION_MODEL || process.env.GROUNDING_MODEL || 'gpt-5.5'
  } = engineParams;

  if (!apiKey || apiKey === 'ollama') {
    // No vision model — basic heuristic
    return {
      success: true,
      assessment: 'No vision model available for reflection — assuming action was successful.',
      nextStep: 'Continue with the next step toward the goal.'
    };
  }

  const beforeB64 = Buffer.isBuffer(screenshotBefore) ? screenshotBefore.toString('base64') : screenshotBefore;
  const afterB64 = Buffer.isBuffer(screenshotAfter) ? screenshotAfter.toString('base64') : screenshotAfter;

  const client = new OpenAI({ apiKey, baseURL });

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a GUI agent reflection assistant. Compare the before and after screenshots.
Assess whether the last action achieved its intended effect.
Respond in JSON: {"success": true/false, "assessment": "brief explanation", "nextStep": "what to do next"}`
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Goal: ${goal}\nLast action: ${lastAction}\n\nBEFORE screenshot:` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${beforeB64}`, detail: 'low' } },
            { type: 'text', text: 'AFTER screenshot:' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${afterB64}`, detail: 'low' } },
            { type: 'text', text: 'Assess the action result as JSON.' }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 300
    });

    const text = response.choices?.[0]?.message?.content || '{}';
    // Try to parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        success: Boolean(parsed.success),
        assessment: String(parsed.assessment || ''),
        nextStep: String(parsed.nextStep || 'Continue.')
      };
    }
  } catch (err) {
    console.error('[GUI Reflection] Failed:', err.message);
  }

  return {
    success: true,
    assessment: 'Reflection model unavailable — continuing.',
    nextStep: 'Proceed with the next action toward the goal.'
  };
}

module.exports = {
  visualGround,
  ocrTextGround,
  groundElement,
  reflectOnAction,
  getOcrWorker
};

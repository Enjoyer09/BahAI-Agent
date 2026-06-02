const TOOLS = [
  { function: { name: "git_clone" } },
  { function: { name: "analyze_codebase" } },
  { function: { name: "find_definition" } },
  { function: { name: "find_references" } },
  { function: { name: "file_edit" } },
  { function: { name: "run_tests" } }
];

function extractTextToolCalls(text) {
  if (!text) return { cleanedText: text, toolCalls: [] };
  
  let cleanedText = text;
  const toolCalls = [];

  // 1. Try to find markdown blocks
  const blockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/ig;
  let match;
  while ((match = blockRegex.exec(cleanedText)) !== null) {
      try {
          const parsed = JSON.parse(match[1]);
          if (parsed && parsed.name && parsed.arguments !== undefined) {
              const isValidTool = TOOLS.some(t => t.function.name === parsed.name);
              if (isValidTool) {
                  toolCalls.push({
                      name: parsed.name,
                      arguments: typeof parsed.arguments === 'object' ? JSON.stringify(parsed.arguments) : String(parsed.arguments)
                  });
                  cleanedText = cleanedText.slice(0, match.index) + cleanedText.slice(match.index + match[0].length);
                  blockRegex.lastIndex = 0;
                  continue;
              }
          }
      } catch(e) {}
  }

  // 2. Try to find raw JSON blocks using balanced braces
  let index = 0;
  while (index < cleanedText.length) {
    const startIdx = cleanedText.indexOf('{', index);
    if (startIdx === -1) break;
    
    let braceCount = 0;
    let inString = false;
    let escape = false;
    let endIndex = startIdx;
    let found = false;
    
    for (; endIndex < cleanedText.length; endIndex++) {
      const char = cleanedText[endIndex];
      if (escape) { escape = false; continue; }
      if (char === '\\') { escape = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (!inString) {
        if (char === '{') braceCount++;
        else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            endIndex++;
            found = true;
            break;
          }
        }
      }
    }
    
    if (found) {
      const possibleJson = cleanedText.substring(startIdx, endIndex);
      try {
        const parsed = JSON.parse(possibleJson);
        if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string' && parsed.arguments !== undefined) {
          const isValidTool = TOOLS.some(t => t.function.name === parsed.name);
          if (isValidTool) {
            toolCalls.push({
              name: parsed.name,
              arguments: typeof parsed.arguments === 'object' ? JSON.stringify(parsed.arguments) : String(parsed.arguments)
            });
            // remove from text, also remove trailing/leading word 'json' if present
            let prefixIndex = startIdx;
            const beforeText = cleanedText.substring(0, startIdx);
            if (beforeText.trim().endsWith('json')) {
               prefixIndex = beforeText.lastIndexOf('json');
            }
            cleanedText = cleanedText.substring(0, prefixIndex) + cleanedText.substring(endIndex);
            index = 0; // reset
            continue;
          }
        }
      } catch (e) {
        console.log("JSON Parse Error:", e.message, "\nString:", possibleJson);
      }
    }
    index = startIdx + 1;
  }
  
  return {
    cleanedText: cleanedText.trim(),
    toolCalls
  };
}

const input = `İlk öncelikli, layihəni audit etmək üçün GitHub reposunu klonlamaq lazımdır. Bu, git_clone alətinin istifadəsi ilə yaxşı olacaqdır.

json

{
  "name": "git_clone",
  "arguments": {
    "url": "https://github.com/Enjoyer09/emalatxana-loyalty.git",
    "folderName": "emalatxana-loyalty"
  }
}
Klonlama prosesi bitdikdə, kodu analiz etmək üçün analyze_codebase alətinin istifadəsi ilə yaxşı olacaqdır.

json

{
  "name": "analyze_codebase",
  "arguments": {
    "path": "/Users/macbookair/Documents/GitHub/emalatxana-loyalty"
  }
}
`;

console.log(extractTextToolCalls(input));

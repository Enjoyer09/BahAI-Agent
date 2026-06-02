const TOOLS = [{ function: { name: "list_directory" } }];
function extractTextToolCalls(text) {
  if (!text) return { cleanedText: text, toolCalls: [] };
  
  const matchesToProcess = [];
  let index = 0;
  
  while (index < text.length) {
    const startIdx = text.indexOf('{', index);
    if (startIdx === -1) break;
    
    // Find balanced closing brace
    let braceCount = 0;
    let inString = false;
    let escape = false;
    let endIndex = startIdx;
    let found = false;
    
    for (; endIndex < text.length; endIndex++) {
      const char = text[endIndex];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
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
      const possibleJson = text.substring(startIdx, endIndex);
      try {
        const parsed = JSON.parse(possibleJson);
        if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string' && parsed.arguments !== undefined) {
          const isValidTool = TOOLS.some(t => t.function.name === parsed.name);
          if (isValidTool) {
            matchesToProcess.push({
              startIndex: startIdx,
              endIndex: endIndex,
              name: parsed.name,
              arguments: typeof parsed.arguments === 'object' ? JSON.stringify(parsed.arguments) : String(parsed.arguments)
            });
            index = endIndex;
            continue;
          }
        }
      } catch (e) {
      }
    }
    index = startIdx + 1;
  }
  
  let cleanedText = text;
  const toolCalls = [];
  
  for (let i = matchesToProcess.length - 1; i >= 0; i--) {
    const match = matchesToProcess[i];
    toolCalls.push({ name: match.name, arguments: match.arguments });
    
    let chunkStart = match.startIndex;
    let chunkEnd = match.endIndex;
    
    const beforeText = cleanedText.substring(Math.max(0, chunkStart - 15), chunkStart);
    const codeBlockMatch = beforeText.match(/```(?:json)?\s*$/i);
    if (codeBlockMatch) {
      chunkStart -= codeBlockMatch[0].length;
      const afterText = cleanedText.substring(chunkEnd, Math.min(cleanedText.length, chunkEnd + 15));
      const closeBlockMatch = afterText.match(/^\s*```/);
      if (closeBlockMatch) {
        chunkEnd += closeBlockMatch[0].length;
      }
    }
    
    cleanedText = cleanedText.substring(0, chunkStart) + cleanedText.substring(chunkEnd);
  }
  
  toolCalls.reverse();
  return { cleanedText: cleanedText.trim(), toolCalls };
}

const input = `bizim agent githuba hec qoshulmur. json
{
  "name": "list_directory",
  "arguments": {
    "path": "/Users/macbookair/Documents/GitHub/Emergent App clone/sandbox/user_9999/default"
  }
}
Bu alət, belirtilmiş kataloğun içindəki faylları və katalogları listəyə cəld edəcək. Daha sonra, hədəf kod hissəsinin nələrə asılı olduğunu yoxlamaq üçün glob_search alətinizi istifadə edə bilərsiniz.`;

console.log(JSON.stringify(extractTextToolCalls(input), null, 2));

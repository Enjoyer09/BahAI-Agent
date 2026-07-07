// ==========================================
// Tool Execution Handler — extracted from index.js
// ==========================================

const path = require('path');
const fs = require('fs/promises');
const util = require('util');
const { execFile, spawn } = require('child_process');
const { glob } = require('glob');

const execFileAsync = util.promisify(execFile);
const pdfParse = require('pdf-parse');

const {
  normalizeToolName, isPathSafe, isBashCommandSafe, isCacheableTool,
  buildToolCallCacheKey, getUserGithubToken, injectGithubTokenIntoUrl,
  readPdfFile, detectRepoProfile, serializeRepoProfile,
  buildValidationPlan, formatValidationReport, fileExists,
  looksLikeOllamaModel, classifyTaskComplexity,
  isAuditStyleRequest, isCurrentFactsOrPublicWebsiteRequest,
  isFileClarificationLoop, flattenResponseJsonText,
  normalizeFinalAssistantReport, buildPhaseRecoveryInstruction,
  buildToolRecoveryInstruction, normalizeUserFacingError,
  generateToolsSystemPrompt, buildDeepSeekRecoveryMessages,
  extractTextToolCalls, shouldEmitDebugEvent, isSensitiveTool,
  extractAttachment, normalizeMessagesForModel,
  mapMessagesToResponsesInput, mapToolsToResponsesTools,
  makeUnifiedDiff, truncatePreview, summarizeDiff,
  buildApprovalMetadata, serializeProject, serializeConversation,
  buildExecutionMemoryHint, buildCompactProjectMemory,
  setAllowedDirs, getWorkspaceRoot, getAllowedDirs,
  ensureDir, resolveWorkingDirectory, isWorkingDirectoryAllowed,
  safeSegment, encryptSecret, decryptSecret
} = require('./helpers');
const { getSession } = require('./browserSession');

async function handleToolCall(toolCall, workingDirectory, user) {
  try {
    const name = normalizeToolName(toolCall?.function?.name);
    const argsJson = toolCall?.function?.arguments || '{}';
    const args = typeof argsJson === 'string' ? JSON.parse(argsJson) : (argsJson || {});

    switch (name) {
      case "check_port_status": {
        const net = require('net');
        return new Promise((resolve) => {
          const socket = new net.Socket();
          socket.setTimeout(2000);
          socket.on('connect', () => { socket.destroy(); resolve(`Port ${args.port} is ACTIVE and listening.`); });
          socket.on('timeout', () => { socket.destroy(); resolve(`Port ${args.port} is CLOSED (Timeout).`); });
          socket.on('error', () => { socket.destroy(); resolve(`Port ${args.port} is CLOSED.`); });
          socket.connect(args.port, '127.0.0.1');
        });
      }

      case "list_directory": {
        const targetPath = path.resolve(workingDirectory, args.path || '.');
        if (!isPathSafe(targetPath, workingDirectory, user)) return "Error: Path outside workspace";
        const files = await fs.readdir(targetPath, { withFileTypes: true });
        return files.map(f => `${f.isDirectory() ? '[DIR] ' : ''}${f.name}`).join('\n');
      }

      case "glob_search": {
        const searchCwd = path.resolve(workingDirectory, args.cwd || '.');
        if (!isPathSafe(searchCwd, workingDirectory, user)) return "Error: Path outside workspace";
        const matches = await glob(args.pattern, { cwd: searchCwd, ignore: ['**/node_modules/**', '**/.git/**'] });
        return matches.join('\n') || "No matches found";
      }

      case "read_file": {
        const filePath = path.resolve(workingDirectory, args.path);
        if (!isPathSafe(filePath, workingDirectory, user)) return "Error: Path outside workspace";
        let content;
        if (filePath.toLowerCase().endsWith('.pdf')) {
          content = await readPdfFile(filePath);
          if (content.length > 50000) return content.slice(0, 50000) + "\n\n[TRUNCATED... File too large]";
          return content;
        } else {
          content = await fs.readFile(filePath, 'utf8');
        }
        const lines = content.split('\n');
        const totalLines = lines.length;
        let startLine = args.start_line ? Math.max(1, parseInt(args.start_line, 10)) : 1;
        let endLine = args.end_line ? Math.max(startLine, parseInt(args.end_line, 10)) : totalLines;
        if (endLine - startLine + 1 > 800) endLine = startLine + 799;
        if (endLine > totalLines) endLine = totalLines;
        const selectedLines = lines.slice(startLine - 1, endLine);
        const formattedLines = selectedLines.map((line, idx) => `${startLine + idx}: ${line}`).join('\n');
        return `File: ${args.path}\nTotal lines: ${totalLines}\nShowing lines ${startLine} to ${endLine}:\n\n${formattedLines}`;
      }

      case "write_file": {
        const filePath = path.resolve(workingDirectory, args.path);
        if (!isPathSafe(filePath, workingDirectory, user)) return "Error: Path outside workspace";
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, args.content, 'utf8');
        return `Successfully created ${args.path}`;
      }

      case "file_edit": {
        const filePath = path.resolve(workingDirectory, args.path);
        if (!isPathSafe(filePath, workingDirectory, user)) return "Error: Path outside workspace";
        const content = await fs.readFile(filePath, 'utf8');
        const occurrences = content.split(args.target_content).length - 1;
        if (occurrences === 0) return `Error: Target content not found in ${args.path}`;
        if (occurrences > 1) return `Error: Target content found ${occurrences} times. Provide more context.`;
        const newContent = content.replace(args.target_content, args.replacement_content);
        await fs.writeFile(filePath, newContent, 'utf8');
        return `Successfully updated ${args.path}`;
      }

      case "run_terminal_command": {
        if (!isBashCommandSafe(args.command)) return "Error: Command blocked or contains unsafe characters.";
        return new Promise((resolve) => {
          const isServerCmd = args.command.includes('dev') || args.command.includes('serve') || args.command.includes('npm run') || args.command.includes('yarn');
          const proc = spawn('sh', ['-c', args.command], { cwd: workingDirectory, detached: true, stdio: 'pipe' });
          let out = "", err = "", resolved = false;
          proc.stdout.on('data', d => {
            out += d;
            if (!resolved && isServerCmd && (out.includes('ready') || out.includes('Local:') || out.includes('localhost:'))) {
              resolved = true; proc.unref(); resolve(`Server started in background.\nSTDOUT Snapshot: ${out}`);
            }
          });
          proc.stderr.on('data', d => err += d);
          proc.on('close', code => { if (!resolved) { resolved = true; resolve(`Exit Code ${code}\nSTDOUT: ${out}\nSTDERR: ${err}`); } });
          proc.on('error', e => { if (!resolved) { resolved = true; resolve(`Process error: ${e.message}\nSTDOUT: ${out}\nSTDERR: ${err}`); } });
          setTimeout(() => {
            if (resolved) return;
            if (isServerCmd) { resolved = true; proc.unref(); resolve(`Server is likely running in background (Timeout reached, but process kept alive).\nSTDOUT: ${out}`); }
            else { try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); } resolved = true; resolve(`Timeout reached: ${out}`); }
          }, isServerCmd ? 5000 : 30000);
        });
      }

      case "git_clone": {
        if (args.folderName.includes('..') || args.folderName.includes('/')) return "Error: Invalid folder name for security reasons.";
        return new Promise((resolve) => {
          const proc = spawn('git', ['clone', args.url, args.folderName], { cwd: workingDirectory });
          let out = "", err = "";
          proc.stdout.on('data', d => out += d);
          proc.stderr.on('data', d => err += d);
          proc.on('close', (code) => { if (code === 0) resolve(`Successfully cloned ${args.url} into ${args.folderName}`); else resolve(`Error cloning: ${err}`); });
          setTimeout(() => { proc.kill(); resolve(`Timeout reached while cloning`); }, 60000);
        });
      }

      case "github_list_contents":
      case "github_read_file":
      case "github_search_code": {
        return await handleGithubTool(name, args, user);
      }

      case "grep_search": {
        const searchCwd = path.resolve(workingDirectory, args.cwd || '.');
        if (!isPathSafe(searchCwd, workingDirectory, user)) return "Error: Path outside workspace";
        try {
          const { stdout } = await execFileAsync('grep', ['-rnI', args.query, searchCwd], { cwd: workingDirectory, timeout: 10000 });
          return stdout.split('\n').slice(0, 50).join('\n') || "No matches found";
        } catch { return "No matches found or grep error"; }
      }

      case "git_status": {
        try { const { stdout } = await execFileAsync('git', ['status', '--short'], { cwd: workingDirectory, timeout: 5000 }); return stdout || "No changes detected"; }
        catch (e) { return `Git status error: ${e.message}`; }
      }

      case "git_diff": {
        try { const gitArgs = args.file ? ['diff', args.file] : ['diff']; const { stdout } = await execFileAsync('git', gitArgs, { cwd: workingDirectory, timeout: 10000 }); return stdout || "No differences found"; }
        catch (e) { return `Git diff error: ${e.message}`; }
      }

      case "git_commit": {
        try {
          if (args.files && args.files.length > 0) await execFileAsync('git', ['add', ...args.files], { cwd: workingDirectory, timeout: 5000 });
          else await execFileAsync('git', ['add', '-A'], { cwd: workingDirectory, timeout: 5000 });
          const { stdout } = await execFileAsync('git', ['commit', '-m', args.message], { cwd: workingDirectory, timeout: 5000 });
          return stdout || `Committed: ${args.message}`;
        } catch (e) { return `Git commit error: ${e.message}`; }
      }

      case "analyze_codebase": {
        const analyzePath = args.path ? path.resolve(workingDirectory, args.path) : workingDirectory;
        if (!isPathSafe(analyzePath, workingDirectory, user)) return "Error: Path outside workspace";
        try {
          const files = await glob('**/*', { cwd: analyzePath, ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**', '**/venv/**', '**/__pycache__/**'], nodir: true });
          const extensions = {};
          files.forEach(file => { const ext = path.extname(file) || 'no-extension'; extensions[ext] = (extensions[ext] || 0) + 1; });
          const topLevel = await fs.readdir(analyzePath, { withFileTypes: true });
          const structure = topLevel.filter(f => !f.name.startsWith('.') && f.name !== 'node_modules' && f.name !== 'dist' && f.name !== 'build').map(f => `${f.isDirectory() ? '📁' : '📄'} ${f.name}`).join('\n');
          const repoProfile = await detectRepoProfile(analyzePath);
          const serializedRepoProfile = serializeRepoProfile(repoProfile);
          let entryContent = '';
          for (const ef of repoProfile.entryPoints) {
            try { const content = await fs.readFile(path.join(analyzePath, ef), 'utf-8'); entryContent = `\n\n📝 Entry point (${ef}) - ilk 50 sətir:\n${content.split('\n').slice(0, 50).join('\n')}`; break; } catch { /* ignore */ }
          }
          const packageInfo = repoProfile.packageJson ? ['', `📦 package.json:`, `  Ad: ${repoProfile.packageJson.name || 'N/A'}`, `  Versiya: ${repoProfile.packageJson.version || 'N/A'}`, `  Scripts: ${Object.keys(repoProfile.packageJson.scripts || {}).join(', ') || 'yoxdur'}`, `  Dependencies: ${Object.keys(repoProfile.packageJson.dependencies || {}).slice(0, 15).join(', ') || 'yoxdur'}`, `  DevDeps: ${Object.keys(repoProfile.packageJson.devDependencies || {}).slice(0, 10).join(', ') || 'yoxdur'}`].join('\n') : '';
          return [`📊 Layihə Analizi: ${analyzePath.split('/').pop()}`, `\n📁 Struktur:\n${structure}`, `\n🧭 Repo Profili:\n  Ekosistem: ${serializedRepoProfile.ecosystem}\n  Package manager: ${serializedRepoProfile.packageManager}\n  Repo tipi: ${serializedRepoProfile.repoShape}\n  Framework/stack: ${serializedRepoProfile.frameworks.join(', ') || 'tam aşkarlanmadı'}\n  Workspace siqnalları: ${serializedRepoProfile.workspaceSignals.join(', ') || 'yoxdur'}\n  Entry points: ${serializedRepoProfile.entryPoints.join(', ') || 'tapılmadı'}\n  Build: ${serializedRepoProfile.buildCommand || 'tapılmadı'}\n  Test: ${serializedRepoProfile.testCommand || 'tapılmadı'}`, `\nÜmumi fayl sayı: ${files.length}`, `Fayl tipləri: ${Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}(${v})`).join(', ')}`, packageInfo, entryContent].filter(Boolean).join('\n');
        } catch (e) { return `Analysis error: ${e.message}`; }
      }

      case "find_definition": {
        const searchCwd = path.resolve(workingDirectory, args.cwd || '.');
        if (!isPathSafe(searchCwd, workingDirectory, user)) return "Error: Path outside workspace";
        try {
          const patterns = [`function ${args.symbol}`, `const ${args.symbol}`, `let ${args.symbol}`, `class ${args.symbol}`, `export.*${args.symbol}`, `def ${args.symbol}`];
          const results = [];
          for (const pattern of patterns) { try { const { stdout } = await execFileAsync('grep', ['-rn', pattern, searchCwd], { cwd: workingDirectory, timeout: 5000 }); if (stdout) results.push(stdout); } catch { /* ignore */ } }
          return results.length > 0 ? results.join('\n').split('\n').slice(0, 20).join('\n') : `Definition of '${args.symbol}' not found`;
        } catch (e) { return `Find definition error: ${e.message}`; }
      }

      case "find_references": {
        const searchCwd = path.resolve(workingDirectory, args.cwd || '.');
        if (!isPathSafe(searchCwd, workingDirectory, user)) return "Error: Path outside workspace";
        try { const { stdout } = await execFileAsync('grep', ['-rn', args.symbol, searchCwd], { cwd: workingDirectory, timeout: 10000 }); const lines = stdout.split('\n').slice(0, 50); return lines.length > 0 ? `Found ${lines.length} references:\n${lines.join('\n')}` : `No references found for '${args.symbol}'`; }
        catch (e) { return `No references found for '${args.symbol}'`; }
      }

      case "web_search": {
        // Tries multiple search backends in order of quality. Google Custom Search
        // (if configured via env) returns the best results. Falls back to DuckDuckGo.
        const query = String(args.query || '').trim();
        if (!query) return 'Axtarış sorğusu daxil edin.';
        const lowerQuery = query.toLowerCase();
        const isWeatherQuery = /\b(hava|weather|temperature|temp|derece|dərəcə)\b/i.test(lowerQuery);
        const cityDisplayName = {
          Baku: 'Bakıda',
          Sumqayit: 'Sumqayıtda',
          Ganja: 'Gəncədə'
        };
        const cityMatch = query.match(/\b(baku|bakı|baki|sumqayit|sumqayıt|ganja|gence|gəncə)\b/i);
        const normalizedCity = cityMatch
          ? ({
              baku: 'Baku',
              bakı: 'Baku',
              baki: 'Baku',
              sumqayit: 'Sumqayit',
              sumqayıt: 'Sumqayit',
              ganja: 'Ganja',
              gence: 'Ganja',
              gəncə: 'Ganja'
            }[cityMatch[1].toLowerCase()] || 'Baku')
          : null;

        if (isWeatherQuery && normalizedCity) {
          try {
            const wttrUrl = `https://wttr.in/${encodeURIComponent(normalizedCity)}?format=%C+%t+%w+%h`;
            const wttrRes = await fetch(wttrUrl, { timeout: 10000, headers: { 'User-Agent': 'bahAI-Agent/1.0' } });
            if (wttrRes.ok) {
              const weatherLine = (await wttrRes.text()).trim();
              if (weatherLine) {
                const cleaned = weatherLine
                  .replace(/\s+/g, ' ')
                  .replace(/\+([0-9])/g, '$1')
                  .trim();
                return `${cityDisplayName[normalizedCity] || normalizedCity} hava belə görünür: ${cleaned}`;
              }
            }
          } catch { /* weather fallback failed; continue to normal search */ }
        }

        const googKey = process.env.GOOGLE_API_KEY || '';
        const googCx = process.env.GOOGLE_CSE_ID || '';

        // 1) Google Custom Search (best quality, requires API key)
        if (googKey && googCx) {
          try {
            const gUrl = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(googKey)}&cx=${encodeURIComponent(googCx)}&q=${encodeURIComponent(query)}&hl=az`;
            const gRes = await fetch(gUrl, { timeout: 10000 });
            if (gRes.ok) {
              const gData = await gRes.json();
              if (gData.items && gData.items.length > 0) {
                const results = gData.items.slice(0, 6).map(item => {
                  const snippet = (item.snippet || '').slice(0, 250);
                  return `• ${item.title}\n  ${item.link}\n  ${snippet}`;
                });
                return `🔍 Google "${query}" üçün nəticələr:\n\n${results.join('\n\n')}`;
              }
            }
          } catch { /* fall through to next backend */ }
        }

        // 2) DuckDuckGo Instant Answer API (free, no key needed, limited coverage)
        try {
          const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
          const ddgRes = await fetch(ddgUrl, { timeout: 10000 });
          if (ddgRes.ok) {
            const data = await ddgRes.json();
            const ddgResults = [];
            if (data.Abstract) ddgResults.push(`📋 ${data.Abstract.slice(0, 600)}`);
            if (data.Answer) ddgResults.push(`✅ ${data.Answer}`);
            if (data.Infobox && data.Infobox.content) {
              data.Infobox.content.slice(0, 6).forEach(item => {
                if (item.label && item.value) ddgResults.push(`• ${item.label}: ${item.value}`);
              });
            }
            if (data.RelatedTopics) {
              data.RelatedTopics.slice(0, 5).forEach(topic => {
                if (topic.Text) ddgResults.push(`• ${topic.Text.slice(0, 300)}`);
                // Handle sub-topics
                if (topic.Topics) topic.Topics.slice(0, 3).forEach(sub => {
                  if (sub.Text) ddgResults.push(`  • ${sub.Text.slice(0, 200)}`);
                });
              });
            }
            if (data.Results) {
              data.Results.slice(0, 4).forEach(item => {
                if (item.Text) ddgResults.push(`• ${item.Text.slice(0, 300)}`);
              });
            }
            if (ddgResults.length > 0) {
              return `🔍 "${query}" üçün nəticələr:\n${ddgResults.join('\n')}`;
            }

            // If DDG returned nothing useful, try a Wikipedia search as extra fallback
            try {
              const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3`;
              const wikiRes = await fetch(wikiUrl, { timeout: 8000 });
              if (wikiRes.ok) {
                const wikiData = await wikiRes.json();
                const wikiHits = wikiData?.query?.search || [];
                if (wikiHits.length > 0) {
                  const wikiResults = wikiHits.map(h => 
                    `• ${h.title}\n  https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}\n  ${(h.snippet || '').replace(/<[^>]+>/g, '').slice(0, 200)}`
                  );
                  return `🔍 "${query}" üçün nəticələr (Wikipedia):\n\n${wikiResults.join('\n\n')}`;
                }
              }
            } catch { /* no wiki fallback */ }
          }
        } catch { /* ddg failed */ }

        const isSportsScheduleQuery = /\b(dünya çempionatı|world championship|oyunlar|games|fixture|schedule|match|matç)\b/i.test(lowerQuery);
        if (isSportsScheduleQuery) {
          return `Daha dəqiq deyin: hansı dünya çempionatını nəzərdə tutursunuz? Məsələn futbol, voleybol, basketbol, şahmat və ya başqa turnir.`;
        }

        if (isWeatherQuery) {
          return `Bu hava sorğusu üçün şəhərin adını daha dəqiq yazın; məsələn: "Bakıda hava necədir?" və ya "Sumqayıtda hava necədir?"`;
        }

        return `"${query}" üçün dəqiq nəticə çıxara bilmədim. Sorğunu bir az daha konkret yazın və ya mövzunu daraldın.`;
      }

      case "web_fetch": {
        try {
          if (!args.url.startsWith('http://') && !args.url.startsWith('https://')) return "Error: URL must start with http:// or https://";
          let urlObj;
          try { urlObj = new URL(args.url); } catch { return "Error: invalid URL"; }
          const host = urlObj.hostname.toLowerCase();
          const isPrivate = (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host.endsWith('.local') || host.endsWith('.internal') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) || /^169\.254\./.test(host) || /^fc[0-9a-f]{2}:/.test(host) || /^fe80:/.test(host));
          if (isPrivate) return "Error: web_fetch private/internal host-larına müraciət edə bilməz.";
          const response = await fetch(args.url, { timeout: 15000, headers: { 'User-Agent': 'bahAI-Agent/1.0' } });
          if (!response.ok) return `Error: HTTP ${response.status}`;
          const text = await response.text();
          const clean = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
          return clean || "Page content is empty";
        } catch (e) { return `Fetch error: ${e.message}`; }
      }

      case "run_tests": {
        try {
          const repoProfile = await detectRepoProfile(workingDirectory);
          const validationPlan = buildValidationPlan(repoProfile, workingDirectory, args);
          if (!validationPlan.steps.length) return "Validation üçün uyğun komanda tapılmadı.";
          const maxSteps = typeof args.maxSteps === 'number' ? Math.max(1, Math.min(validationPlan.steps.length, args.maxSteps)) : validationPlan.steps.length;
          const stopOnFailure = args.stopOnFailure !== false;
          const results = [];
          for (const step of validationPlan.steps.slice(0, maxSteps)) {
            try { const { stdout, stderr } = await execFileAsync('sh', ['-c', step.command], { cwd: workingDirectory, timeout: 90000, env: { ...process.env, CI: 'true', FORCE_COLOR: '0' } }); results.push({ ...step, status: 'passed', output: `${stdout || ''}${stderr || ''}`.trim().slice(0, 3000) }); }
            catch (e) { const output = `${e.stdout || ''}${e.stderr || ''}`.trim().slice(0, 3000); results.push({ ...step, status: 'failed', output: output || e.message }); if (stopOnFailure) break; }
          }
          return formatValidationReport(validationPlan, results);
        } catch (e) { return `Validation error: ${e.message}`; }
      }

      case "multi_file_edit": {
        if (!Array.isArray(args.edits)) return "Error: edits must be an array";
        const results = [];
        for (const edit of args.edits) {
          const editPath = path.resolve(workingDirectory, edit.path);
          if (!isPathSafe(editPath, workingDirectory, user)) { results.push(`${edit.path}: Error: Path outside workspace`); continue; }
          try {
            const content = await fs.readFile(editPath, 'utf8');
            const occurrences = content.split(edit.target_content).length - 1;
            if (occurrences === 0) { results.push(`${edit.path}: Target content not found`); continue; }
            if (occurrences > 1) { results.push(`${edit.path}: Target content found ${occurrences} times`); continue; }
            await fs.writeFile(editPath, content.replace(edit.target_content, edit.replacement_content), 'utf8');
            results.push(`${edit.path}: Updated successfully`);
          } catch (e) { results.push(`${edit.path}: Error - ${e.message}`); }
        }
        return results.join('\n');
      }

      case "browser_open":
      case "browser_click":
      case "browser_type":
      case "browser_screenshot":
      case "browser_wait_for":
      case "browser_eval":
      case "browser_press":
      case "browser_scroll":
      case "browser_extract":
        return await handleBrowserTool(name, args, workingDirectory);

      case "gui_observe":
      case "gui_act":
      case "gui_step":
        return await handleGuiTool(name, args, workingDirectory);

      case "screen_open_url":
      case "screen_screenshot":
      case "screen_click":
      case "screen_type":
      case "screen_press":
      case "screen_scroll":
        return `Screen agent tools not available in this environment. Use browser-based tools instead.`;

      case "computer_use_act":
      case "computer_use_step":
        return `Computer Use tools not available in this environment. Use browser-based GUI tools instead.`;

      case "start_server": {
        if (!isBashCommandSafe(args.command)) return "Error: Command blocked or contains unsafe characters.";
        return new Promise((resolve) => {
          const proc = spawn('sh', ['-c', args.command], { cwd: workingDirectory, detached: true, stdio: 'pipe' });
          let out = "", resolved = false;
          proc.stdout.on('data', d => { out += d; if (!resolved && (out.includes('ready') || out.includes('Local:') || out.includes('localhost:'))) { resolved = true; proc.unref(); resolve(`Server started on port ${args.port}.\n${out}`); } });
          proc.stderr.on('data', d => { if (!resolved) out += d; });
          proc.on('close', code => { if (!resolved) { resolved = true; resolve(`Server process exited with code ${code}\n${out}`); } });
          proc.on('error', e => { if (!resolved) { resolved = true; resolve(`Error: ${e.message}`); } });
          setTimeout(() => { if (!resolved) { resolved = true; proc.unref(); resolve(`Server start initiated (timeout).\n${out}`); } }, 15000);
        });
      }

      case "git_push": {
        try {
          await execFileAsync('git', ['push', ...(args.branch ? ['origin', args.branch] : [])], { cwd: workingDirectory, timeout: 30000 });
          return `Push successful${args.branch ? ` to ${args.branch}` : ''}`;
        } catch (e) { return `Push error: ${e.message}`; }
      }

      case "git_log": {
        try { const { stdout } = await execFileAsync('git', ['log', `--max-count=${args.count || 10}`, '--oneline', '--graph'], { cwd: workingDirectory, timeout: 5000 }); return stdout || "No commits found"; }
        catch (e) { return `Git log error: ${e.message}`; }
      }

      case "git_branch": {
        try {
          if (args.name) { await execFileAsync('git', ['checkout', '-b', args.name], { cwd: workingDirectory, timeout: 5000 }); return `Created and switched to branch: ${args.name}`; }
          else { const { stdout } = await execFileAsync('git', ['branch'], { cwd: workingDirectory, timeout: 5000 }); return stdout || "No branches"; }
        } catch (e) { return `Git branch error: ${e.message}`; }
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (error) {
    return `Error executing tool: ${error.message}`;
  }
}

// ==========================================
// GitHub tool helpers
// ==========================================

async function handleGithubTool(name, args, user) {
  try {
    const token = await getUserGithubToken(user?.id).catch(() => null);
    const headers = { 'User-Agent': 'bahAI-Agent', 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `token ${token}`;

    if (name === "github_list_contents") {
      const { owner, repo, path: repoPath = '' } = args;
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}`, { headers });
      if (!response.ok) return `GitHub API Error: ${response.status} ${response.statusText}`;
      const data = await response.json();
      if (Array.isArray(data)) return data.map(item => `[${item.type}] ${item.path}`).join('\n') || "Directory is empty";
      return `Found single file: ${data.path} (Use github_read_file to read it)`;
    }

    if (name === "github_read_file") {
      const { owner, repo, path: filePath } = args;
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, { headers });
      if (!response.ok) return `GitHub API Error: ${response.status} ${response.statusText}`;
      const data = await response.json();
      if (data.type === 'file' && data.content && data.encoding === 'base64') return Buffer.from(data.content, 'base64').toString('utf8');
      return `Error: Target is not a base64 encoded file (type: ${data.type})`;
    }

    if (name === "github_search_code") {
      const { owner, repo, query } = args;
      const encodedQuery = encodeURIComponent(`${query} repo:${owner}/${repo}`);
      const response = await fetch(`https://api.github.com/search/code?q=${encodedQuery}`, { headers });
      if (!response.ok) {
        if (response.status === 401) return "Xəta: GitHub-da axtarış etmək üçün sistemə GitHub hesabı əlavə edilməlidir.";
        return `GitHub API Error: ${response.status} ${response.statusText}`;
      }
      const data = await response.json();
      if (data.items && data.items.length > 0) return `Found matches in:\n${data.items.slice(0, 10).map(item => `[Match in ${item.path}]`).join('\n')}\n\n(Use github_read_file to read the full code)`;
      return "No matches found for your query.";
    }
  } catch (err) {
    return `GitHub API error: ${err.message}`;
  }
}

// ==========================================
// Browser tool helpers
// ==========================================

async function handleBrowserTool(name, args, workingDirectory) {
  try {
    const sessionId = args.sessionId || 'default';
    const session = await getSession(sessionId, {
      url: args.url,
      visible: args.visible,
      slowMoMs: args.slowMoMs,
      browserChannel: args.browserChannel,
      executablePath: args.executablePath,
      cdpUrl: args.cdpUrl,
      persistent: args.persistent,
      userDataDir: args.userDataDir
    });

    switch (name) {
      case "browser_open": {
        await session.page.goto(String(args.url), { waitUntil: 'domcontentloaded', timeout: 30000 });
        return `Browser opened: ${args.url}`;
      }
      case "browser_click": {
        await session.page.locator(args.selector).first().click({ timeout: 15000 });
        return `Clicked: ${args.selector}`;
      }
      case "browser_type": {
        if (args.selector) await session.page.locator(args.selector).first().click({ timeout: 15000 });
        await session.page.keyboard.type(String(args.text || ''), { delay: 20 });
        return `Typed: ${String(args.text || '').slice(0, 50)}`;
      }
      case "browser_screenshot": {
        const screenshotPath = `/tmp/bahai-browser-shot-${Date.now()}.png`;
        await session.page.screenshot({ path: screenshotPath, fullPage: Boolean(args.fullPage) });
        return `Screenshot saved: ${screenshotPath}`;
      }
      case "browser_wait_for": {
        if (args.selector) await session.page.waitForSelector(args.selector, { state: args.state || 'visible', timeout: args.timeoutMs || 15000 });
        else if (args.state) await session.page.waitForLoadState(args.state, { timeout: args.timeoutMs || 15000 });
        return `Waited for ${args.selector || args.state || 'page load'}`;
      }
      case "browser_eval": {
        const result = await session.page.evaluate(args.expression);
        return `Result: ${JSON.stringify(result, null, 2).slice(0, 2000)}`;
      }
      case "browser_press": {
        await session.page.keyboard.press(String(args.key));
        return `Pressed: ${args.key}`;
      }
      case "browser_scroll": {
        if (args.to === 'top') await session.page.evaluate(() => window.scrollTo(0, 0));
        else if (args.to === 'bottom') await session.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        else await session.page.evaluate((x, y) => window.scrollBy(x || 0, y || 600), args.x, args.y);
        return `Scrolled${args.to ? ` to ${args.to}` : ` by (${args.x || 0}, ${args.y || 600})`}`;
      }
      case "browser_extract": {
        const elements = await session.page.$$(args.selector);
        const limit = args.limit || elements.length;
        const results = [];
        for (let i = 0; i < Math.min(elements.length, limit); i++) {
          const el = elements[i];
          const entry = {};
          if (args.fields?.includes('text') || !args.fields) entry.text = await el.textContent().catch(() => '');
          if (args.fields?.includes('html')) entry.html = await el.innerHTML().catch(() => '');
          if (args.fields?.includes('href')) entry.href = await el.getAttribute('href').catch(() => '');
          if (args.fields?.includes('src')) entry.src = await el.getAttribute('src').catch(() => '');
          if (args.fields?.includes('value')) entry.value = await el.getAttribute('value').catch(() => '');
          if (args.fields?.includes('ariaLabel')) entry.ariaLabel = await el.getAttribute('aria-label').catch(() => '');
          results.push(entry);
        }
        return JSON.stringify(results, null, 2).slice(0, 5000);
      }
      default:
        return `Unknown browser tool: ${name}`;
    }
  } catch (error) {
    return `Browser ${name} error: ${error.message}`;
  }
}

// ==========================================
// GUI tool helpers
// ==========================================

async function handleGuiTool(name, args, workingDirectory) {
  try {
    const { inspectGuiState, runGuiAction, stepGuiAgent } = require('./gui/agent');
    const sessionId = args.sessionId || 'default';
    await require('./browserSession').getSession(sessionId);
    const baseParams = { sessionId, workingDirectory };

    switch (name) {
      case "gui_observe": {
        const result = await inspectGuiState({ ...baseParams, goal: args.goal || '', history: args.history || [] });
        return JSON.stringify({ observation: result.observation, groundingPrompt: result.groundingPrompt });
      }
      case "gui_act": {
        const result = await runGuiAction({ ...baseParams, action: args.action, history: args.history || [], minConfidence: args.minConfidence || 0.35 });
        return JSON.stringify({ action: result.action, result: result.result, observation: result.observation, reflection: result.reflection });
      }
      case "gui_step": {
        const result = await stepGuiAgent({
          ...baseParams, goal: args.goal || '', action: args.action, history: args.history || [],
          autoGround: args.autoGround, groundingMode: args.groundingMode || 'prompt_only', minConfidence: args.minConfidence || 0.35
        });
        return JSON.stringify({ observation: result.observation, action: result.action, assessment: result.assessment, result: result.result, reflection: result.reflection });
      }
      default:
        return `Unknown GUI tool: ${name}`;
    }
  } catch (error) {
    return `GUI ${name} error: ${error.message}`;
  }
}

module.exports = { handleToolCall };

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'Lists the files and folders in a given directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'glob_search',
      description: 'Find files using a glob pattern (e.g., src/**/*.ts).',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          cwd: { type: 'string' }
        },
        required: ['pattern', 'cwd']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Reads the content of a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          start_line: { type: 'number', description: 'Optional. Startline to view, 1-indexed as usual, inclusive.' },
          end_line: { type: 'number', description: 'Optional. Endline to view, 1-indexed as usual, inclusive.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Creates a new file with the given content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'file_edit',
      description: 'Edits a specific part of a file by replacing a unique string.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          target_content: { type: 'string' },
          replacement_content: { type: 'string' }
        },
        required: ['path', 'target_content', 'replacement_content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_port_status',
      description: 'Checks if a specific port is active and listening for connections.',
      parameters: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'The port number to check (e.g. 5173)' }
        },
        required: ['port']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_terminal_command',
      description: 'Runs a safe terminal command in the project directory.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_clone',
      description: 'Clones a git repository from a URL into the current directory.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The GitHub repository URL (HTTPS)' },
          folderName: { type: 'string', description: 'The name of the folder to clone into' }
        },
        required: ['url', 'folderName']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'github_list_contents',
      description: 'List files and directories in a remote GitHub repository via API without cloning. Useful for remote analysis.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: "The owner of the repository (e.g. 'octocat')" },
          repo: { type: 'string', description: "The repository name (e.g. 'Hello-World')" },
          path: { type: 'string', description: 'The path inside the repository to list (default is empty string for root)' }
        },
        required: ['owner', 'repo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'github_read_file',
      description: 'Reads a file directly from a remote GitHub repository via API without cloning.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'The owner of the repository' },
          repo: { type: 'string', description: 'The repository name' },
          path: { type: 'string', description: 'The full path to the file inside the repo' }
        },
        required: ['owner', 'repo', 'path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'github_search_code',
      description: "Search for code, keywords, or symbols in a remote GitHub repository using GitHub's Search API.",
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'The owner of the repository' },
          repo: { type: 'string', description: 'The repository name' },
          query: { type: 'string', description: "The search query (e.g. 'functionName' or 'finance')" }
        },
        required: ['owner', 'repo', 'query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description: 'Search for a string pattern in the codebase using grep.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          cwd: { type: 'string' }
        },
        required: ['query', 'cwd']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Shows the current git status (modified, staged, untracked files).',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Shows git diff for modified files or a specific file.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Optional: specific file to diff' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: 'Creates a git commit with the given message.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message' },
          files: { type: 'array', items: { type: 'string' }, description: 'Files to stage (optional, stages all if empty)' }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_auto_commit',
      description: 'Analyzes unstaged and staged git changes, generates an automated conventional commit message (feat, fix, docs, refactor, style, test), stages modified files, and commits them automatically.',
      parameters: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' }, description: 'Optional list of specific files to commit. If omitted or empty, stages all modified workspace files.' },
          context: { type: 'string', description: 'Optional user intent or context description to help generate a more accurate commit message.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_checkpoint',
      description: 'Creates a workspace state snapshot/checkpoint before executing risky file edits or terminal commands. Allows rolling back if something breaks.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Description/label for this checkpoint (e.g., "before refactoring auth")' }
        },
        required: ['label']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'rewind_checkpoint',
      description: 'Rewinds/restores the workspace state to a previously created checkpoint or stash snapshot.',
      parameters: {
        type: 'object',
        properties: {
          checkpointId: { type: 'string', description: 'Optional checkpoint label or stash ID to rewind to. Omit to restore the latest checkpoint.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'analyze_codebase',
      description: 'Analyzes the codebase structure and provides a summary (file count, languages, dependencies).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to analyze (defaults to current directory)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_definition',
      description: 'Finds the definition of a function, class, or variable in the codebase.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol name to find' },
          cwd: { type: 'string' }
        },
        required: ['symbol', 'cwd']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_references',
      description: 'Finds all references/usages of a function, class, or variable.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol name to find references for' },
          cwd: { type: 'string' }
        },
        required: ['symbol', 'cwd']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Searches the web for information. Use for documentation, error solutions, latest API references. Supports batch: pass `queries` array for parallel multi-query search (e.g. 2-3 related queries at once to speed up research).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Single search query' },
          queries: { type: 'array', items: { type: 'string' }, description: 'Multiple queries to search in parallel (saves time for research questions). Each item is a separate search.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetches HTML content from a URL via HTTP GET. Does NOT execute JavaScript — only works for static HTML pages, blogs, API docs. For dynamic/JS-heavy sites (e-commerce, React/SPA, dashboards) use browser_open instead.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_tests',
      description: 'Runs repo-aware validation and returns structured results. Prefers lint, type-check, test, and build commands based on detected stack and package manager.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Optional: filter tests by name or file pattern' },
          maxSteps: { type: 'number', description: 'Optional: limit how many validation steps to run from the generated plan' },
          stopOnFailure: { type: 'boolean', description: 'Optional: stop after the first failed validation step. Defaults to true.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_push',
      description: 'Pushes committed changes to remote repository.',
      parameters: {
        type: 'object',
        properties: {
          branch: { type: 'string', description: 'Branch name (defaults to current branch)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: 'Shows recent git commit history.',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'Number of commits to show (default: 10)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_branch',
      description: 'Lists branches or creates a new branch.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'New branch name to create (omit to list branches)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'start_server',
      description: 'Starts a development server in background (npm run dev, python -m http.server, etc). Returns after server starts.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: "Server start command (e.g. 'npm run dev', 'npx serve')" },
          port: { type: 'number', description: 'Expected port number' }
        },
        required: ['command', 'port']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_open',
      description: 'Opens a URL in a real Playwright/Chrome browser. Renders JavaScript — use this for dynamic sites, e-commerce, SPAs, dashboards, and login pages. For static HTML only, use web_fetch instead.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target URL to open' },
          sessionId: { type: 'string', description: 'Optional browser session id' },
          visible: { type: 'boolean', description: 'Open a visible browser window so the user can watch GUI actions live.' },
          slowMoMs: { type: 'number', description: 'Optional delay in milliseconds between browser actions for easier watching.' },
          browserChannel: { type: 'string', enum: ['chrome', 'msedge', 'chromium'], description: 'Optional installed browser channel. Use chrome to open real Google Chrome instead of Chrome for Testing.' },
          executablePath: { type: 'string', description: 'Optional absolute path to a browser executable.' },
          cdpUrl: { type: 'string', description: 'Optional Chrome DevTools Protocol URL, e.g. http://127.0.0.1:9222, to attach to a user-launched Chrome session.' },
          persistent: { type: 'boolean', description: 'Use a persistent browser profile so logins/cookies survive across sessions.' },
          userDataDir: { type: 'string', description: 'Optional browser profile directory for persistent sessions.' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Clicks an element in the active Playwright browser session using a CSS selector.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to click' },
          sessionId: { type: 'string', description: 'Optional browser session id' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Types text into an element in the active Playwright browser session.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to type into' },
          text: { type: 'string', description: 'Text to enter' },
          sessionId: { type: 'string', description: 'Optional browser session id' }
        },
        required: ['selector', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: 'Captures a screenshot from the active Playwright browser session.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Optional browser session id' },
          fullPage: { type: 'boolean', description: 'Whether to capture the full page' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_wait_for',
      description: 'Waits for a selector or page load state in the active Playwright browser session.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Optional CSS selector to wait for' },
          state: { type: 'string', enum: ['visible', 'hidden', 'attached', 'detached', 'load', 'domcontentloaded', 'networkidle'], description: 'Selector state or page load state to wait for' },
          timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds' },
          sessionId: { type: 'string', description: 'Optional browser session id' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_eval',
      description: 'Evaluates a JavaScript expression in the browser page. Use after browser_open to extract rendered content: evaluate document.body.innerText for all text, or document.querySelectorAll(...) for specific elements. Ideal for scraping dynamic/JS-rendered pages.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'JavaScript expression evaluated as ( ) => expression in the page context' },
          sessionId: { type: 'string', description: 'Optional browser session id' }
        },
        required: ['expression']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_press',
      description: 'Presses a keyboard key, optionally on a specific element in the active Playwright browser session.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Keyboard key such as Enter, Tab, Escape, ArrowDown' },
          selector: { type: 'string', description: 'Optional CSS selector to focus before pressing the key' },
          sessionId: { type: 'string', description: 'Optional browser session id' }
        },
        required: ['key']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_scroll',
      description: 'Scrolls the page or a specific element in the active Playwright browser session.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Optional CSS selector for a scrollable element' },
          x: { type: 'number', description: 'Horizontal scroll delta in pixels' },
          y: { type: 'number', description: 'Vertical scroll delta in pixels' },
          to: { type: 'string', enum: ['top', 'bottom'], description: 'Optional absolute scroll target for page or element' },
          sessionId: { type: 'string', description: 'Optional browser session id' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_extract',
      description: 'Extracts structured text, attributes, or links from matching DOM elements in the active Playwright browser session.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for elements to extract from' },
          fields: {
            type: 'array',
            description: 'Which fields to include for each matched element',
            items: {
              type: 'string',
              enum: ['text', 'html', 'href', 'src', 'value', 'ariaLabel']
            }
          },
          limit: { type: 'number', description: 'Maximum number of matched elements to return' },
          sessionId: { type: 'string', description: 'Optional browser session id' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'gui_observe',
      description: 'Captures a GUI observation snapshot and returns a grounding-ready prompt payload for the current session.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Optional GUI/browser session id' },
          goal: { type: 'string', description: 'Optional high-level goal for the GUI task' },
          history: { type: 'array', description: 'Optional recent GUI action history', items: { type: 'object' } }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'gui_act',
      description: 'Executes a structured GUI action and returns the next observation snapshot.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Optional GUI/browser session id' },
          action: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['click', 'type', 'press', 'scroll'] },
              selector: { type: 'string' },
              text: { type: 'string' },
              key: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              confidence: { type: 'number' },
              reasoning: { type: 'string' }
            },
            required: ['type']
          },
          history: { type: 'array', description: 'Optional recent GUI action history', items: { type: 'object' } }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'gui_step',
      description: 'Runs one GUI observe/act/reflect loop step and returns observation, action result, and reflection.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Optional GUI/browser session id' },
          goal: { type: 'string', description: 'High-level GUI goal' },
          action: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['click', 'type', 'press', 'scroll'] },
              selector: { type: 'string' },
              text: { type: 'string' },
              key: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              confidence: { type: 'number' },
              reasoning: { type: 'string' }
            }
          },
          history: { type: 'array', description: 'Optional recent GUI action history', items: { type: 'object' } },
          autoGround: { type: 'boolean', description: 'When true, ask the configured model to propose the next GUI action if no action is provided.' },
          groundingMode: { type: 'string', enum: ['prompt_only', 'provider'], description: 'Use prompt_only to observe without execution, or provider to allow model-grounded action proposals.' },
          minConfidence: { type: 'number', description: 'Minimum confidence required before executing a grounded action.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'multi_file_edit',
      description: 'Edits multiple files at once. More efficient than calling file_edit multiple times.',
      parameters: {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                target_content: { type: 'string' },
                replacement_content: { type: 'string' }
              },
              required: ['path', 'target_content', 'replacement_content']
            },
            description: 'Array of file edits to apply'
          }
        },
        required: ['edits']
      }
    }
  },
  // ─── Screen Agent Tools (TeamViewer-style, no Playwright) ───
  {
    type: 'function',
    function: {
      name: 'screen_open_url',
      description: 'Opens a URL in the user\'s default browser (real Chrome, no automation). Use this instead of browser_open when login is needed.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to open' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'screen_screenshot',
      description: 'Takes a screenshot of the entire screen. Returns the image for visual analysis.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'screen_click',
      description: 'Clicks at specific screen coordinates (x, y). Use after analyzing a screenshot to click on a UI element.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate on screen' },
          y: { type: 'number', description: 'Y coordinate on screen' },
          clicks: { type: 'number', description: 'Number of clicks (default 1, use 2 for double-click)' },
          button: { type: 'string', description: 'Mouse button: left, right, middle' }
        },
        required: ['x', 'y']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'screen_type',
      description: 'Types text using the keyboard. Click on a text field first, then use this to type.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to type' }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'screen_press',
      description: 'Presses a key or key combination (e.g. "enter", "command+a", "tab").',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key to press (e.g. enter, tab, escape, command+c, command+v)' }
        },
        required: ['key']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'screen_scroll',
      description: 'Scrolls the screen. Negative = scroll down, positive = scroll up.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Scroll amount (-3 = down, 3 = up)' },
          x: { type: 'number', description: 'Optional: X coordinate to scroll at' },
          y: { type: 'number', description: 'Optional: Y coordinate to scroll at' }
        },
        required: ['amount']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'computer_use_act',
      description: 'Executes a local desktop Computer Use action such as open_app, open_url, click, type, press, scroll, or screenshot.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['open_app', 'open_url', 'click', 'type', 'press', 'scroll', 'screenshot'] },
              app: { type: 'string' },
              url: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              clicks: { type: 'number' },
              button: { type: 'string' },
              text: { type: 'string' },
              key: { type: 'string' },
              amount: { type: 'number' }
            },
            required: ['type']
          }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'computer_use_step',
      description: 'Runs one Computer Use observe/act/reflection step and returns screenshots plus structured action output.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string' },
          action: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['open_app', 'open_url', 'click', 'type', 'press', 'scroll', 'screenshot'] },
              app: { type: 'string' },
              url: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              clicks: { type: 'number' },
              button: { type: 'string' },
              text: { type: 'string' },
              key: { type: 'string' },
              amount: { type: 'number' }
            }
          },
          history: { type: 'array', items: { type: 'object' } }
        },
        required: []
      }
    }
  }
];

function getToolDefinitions() {
  const { mcpGateway } = require('../chat/mcpGateway');
  const baseTools = TOOL_DEFINITIONS.map((tool) => ({ ...tool, function: { ...tool.function } }));
  return [...baseTools, ...mcpGateway.getTools()];
}

function getToolNames() {
  return TOOL_DEFINITIONS.map((tool) => tool.function.name);
}

function hasTool(toolName) {
  return TOOL_DEFINITIONS.some((tool) => tool.function.name === toolName);
}

module.exports = {
  TOOL_DEFINITIONS,
  getToolDefinitions,
  getToolNames,
  hasTool
};

const { getToolNames, getToolDefinitions } = require('./registry');

const ALL_TOOLS = getToolNames();

const READ_ONLY_TOOLS = [
  'list_directory',
  'glob_search',
  'read_file',
  'grep_search',
  'analyze_codebase',
  'find_definition',
  'find_references',
  'web_search',
  'web_fetch',
  'git_status',
  'git_diff',
  'git_log',
  'check_port_status',
  'github_list_contents',
  'github_read_file',
  'github_search_code'
];

const BUILDER_TOOLS = Array.from(new Set([
  ...READ_ONLY_TOOLS,
  'write_file',
  'file_edit',
  'multi_file_edit',
  'run_terminal_command',
  'run_tests',
  'start_server',
  'browser_open',
  'browser_click',
  'browser_type',
  'browser_screenshot',
  'browser_wait_for',
  'browser_eval',
  'browser_press',
  'browser_scroll',
  'browser_extract',
  'gui_observe',
  'gui_act',
  'gui_step',
  'git_branch',
  'git_commit',
  'git_auto_commit',
  'create_checkpoint',
  'rewind_checkpoint',
  'git_push'
]));

const REVIEWER_TOOLS = Array.from(new Set([
  ...READ_ONLY_TOOLS,
  'run_tests'
]));

const WEB_CHAT_PUBLISH_TOOLS = [
  // Tools that mutate nothing in the user's project but perform a safe external
  // action (publishing a page, reading the user's freshly-shared screen).
  // Allowed in web_chat so end users can ask the agent to create live web pages
  // or reference what they see, but NOT in READ_ONLY_TOOLS so role-restricted
  // profiles (Planner/Architect) keep their read-only guarantee.
  'build_and_publish_app',
  'capture_my_screen'
];

const WEB_CHAT_AWARENESS_TOOLS = [
  // Read-only access to ephemeral user state (latest screenshot). Does not
  // mutate anything in the user's project.
  // NOTE: capture_my_screen is also in WEB_CHAT_PUBLISH_TOOLS so it lives in
  // both groups — the union below picks it up exactly once.
];

const WEB_CHAT_TOOLS = Array.from(new Set([
  ...READ_ONLY_TOOLS,
  ...WEB_CHAT_PUBLISH_TOOLS,
  ...WEB_CHAT_AWARENESS_TOOLS
]));

const TOOL_PROFILES = {
  solo: ALL_TOOLS,
  default: ALL_TOOLS,
  quick: ALL_TOOLS,
  thorough: ALL_TOOLS,
  audit: ALL_TOOLS,
  coding: ALL_TOOLS,
  'review-only': ALL_TOOLS,
  'desktop-local': ALL_TOOLS,
  'web-chat': WEB_CHAT_TOOLS
};

const ROLE_TOOL_PROFILES = {
  Manager: [],
  'Solo Agent': ALL_TOOLS,
  Planner: READ_ONLY_TOOLS,
  Architect: READ_ONLY_TOOLS,
  Reviewer: REVIEWER_TOOLS,
  Security: REVIEWER_TOOLS,
  QA: REVIEWER_TOOLS,
  Builder: BUILDER_TOOLS,
  Implementer: BUILDER_TOOLS,
  'Computer Use Operator': ALL_TOOLS
};

const WORKFLOW_TO_PROFILE = {
  solo: 'solo',
  quick: 'quick',
  default: 'default',
  thorough: 'thorough',
  'review-only': 'review-only',
  computer_use: 'desktop-local'
};

function getToolProfile(profileName = 'default') {
  return TOOL_PROFILES[profileName] || TOOL_PROFILES.default;
}

function getToolProfileForWorkflow(workflow = 'default') {
  return WORKFLOW_TO_PROFILE[workflow] || 'default';
}

function getToolsForProfile(profileName = 'default') {
  const allowed = new Set(getToolProfile(profileName));
  return getToolDefinitions().filter((tool) => allowed.has(tool.function.name));
}

function getToolsForRole(roleName = 'Solo Agent', fallbackProfile = 'default') {
  const roleTools = ROLE_TOOL_PROFILES[roleName] || ALL_TOOLS;
  const profileTools = getToolProfile(fallbackProfile);
  const allowed = new Set(roleTools.filter((toolName) => profileTools.includes(toolName)));
  return getToolDefinitions().filter((tool) => allowed.has(tool.function.name));
}

module.exports = {
  TOOL_PROFILES,
  ROLE_TOOL_PROFILES,
  WORKFLOW_TO_PROFILE,
  getToolProfile,
  getToolProfileForWorkflow,
  getToolsForProfile,
  getToolsForRole
};

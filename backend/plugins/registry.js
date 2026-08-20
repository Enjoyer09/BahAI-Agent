const fs = require('fs');
const path = require('path');

class PluginRegistry {
  constructor() {
    this.plugins = new Map();
    this.pluginDir = path.resolve(__dirname, '../../plugins');
    this.init();
  }

  init() {
    if (!fs.existsSync(this.pluginDir)) {
      try {
        fs.mkdirSync(this.pluginDir, { recursive: true });
        this.createSamplePlugin();
      } catch (err) {
        console.warn('⚠️ Plugin directory could not be created:', err.message);
      }
    }
    this.loadPlugins();
  }

  createSamplePlugin() {
    const samplePath = path.join(this.pluginDir, 'sample-formatter.js');
    if (!fs.existsSync(samplePath)) {
      const sampleCode = `// Sample Plugin for BahAI Agent
module.exports = {
  name: 'sample-formatter',
  version: '1.0.0',
  description: 'Sample text formatting plugin',
  execute: async (context) => {
    return { status: 'success', message: 'Sample plugin executed successfully' };
  }
};
`;
      fs.writeFileSync(samplePath, sampleCode, 'utf8');
    }
  }

  loadPlugins() {
    if (!fs.existsSync(this.pluginDir)) return;
    try {
      const files = fs.readdirSync(this.pluginDir);
      for (const file of files) {
        if (file.endsWith('.js')) {
          try {
            const pluginPath = path.join(this.pluginDir, file);
            delete require.cache[require.resolve(pluginPath)];
            const plugin = require(pluginPath);
            if (plugin && plugin.name) {
              this.plugins.set(plugin.name, plugin);
              console.log(`🔌 Loaded plugin: [${plugin.name} v${plugin.version || '1.0.0'}]`);
            }
          } catch (err) {
            console.error(`❌ Failed to load plugin ${file}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error('❌ Plugin loading error:', err.message);
    }
  }

  listPlugins() {
    const list = [];
    for (const [name, plugin] of this.plugins.entries()) {
      list.push({
        name,
        version: plugin.version || '1.0.0',
        description: plugin.description || '',
      });
    }
    return list;
  }

  async executePlugin(name, context) {
    const plugin = this.plugins.get(name);
    if (!plugin || typeof plugin.execute !== 'function') {
      throw new Error(`Plugin '${name}' not found or invalid`);
    }
    return await plugin.execute(context);
  }
}

const registry = new PluginRegistry();
module.exports = registry;

// Sample Plugin for BahAI Agent
module.exports = {
  name: 'sample-formatter',
  version: '1.0.0',
  description: 'Sample text formatting plugin',
  execute: async (context) => {
    return { status: 'success', message: 'Sample plugin executed successfully' };
  }
};

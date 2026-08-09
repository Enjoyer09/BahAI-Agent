// ==========================================
// Deploy Route — Project deployment pipeline
// ==========================================

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs/promises');
const { requireWorkspaceAccess, verifyToken } = require('../auth');
const { resolveWorkingDirectory, isPathSafe } = require('../helpers');

// POST /api/deploy/detect — Detect project type and suggest platform
router.post('/detect', requireWorkspaceAccess, async (req, res) => {
  try {
    const resolvedWD = resolveWorkingDirectory(req.body.workingDirectory, req.user);
    const projectType = await detectProjectType(resolvedWD);
    res.json(projectType);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/deploy/configure — Generate deploy config files
router.post('/configure', requireWorkspaceAccess, async (req, res) => {
  try {
    const { platform } = req.body;
    const resolvedWD = resolveWorkingDirectory(req.body.workingDirectory, req.user);
    const configResult = await generateDeployConfig(resolvedWD, platform);
    res.json(configResult);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Helpers ─────────────────────────────────────

async function detectProjectType(projectDir) {
  const result = {
    type: 'unknown',
    framework: null,
    suggestedPlatform: 'railway',
    hasPackageJson: false,
    hasRequirementsTxt: false,
    hasDockerfile: false,
  };

  try {
    // Check package.json
    const pkgPath = path.join(projectDir, 'package.json');
    try {
      const pkgContent = await fs.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(pkgContent);
      result.hasPackageJson = true;

      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (allDeps['next']) {
        result.type = 'nextjs';
        result.framework = 'Next.js';
        result.suggestedPlatform = 'vercel';
      } else if (allDeps['react'] && !allDeps['express']) {
        result.type = 'react-spa';
        result.framework = 'React';
        result.suggestedPlatform = 'vercel';
      } else if (allDeps['express'] || allDeps['fastify'] || allDeps['koa']) {
        result.type = 'node-api';
        result.framework = allDeps['express'] ? 'Express' : allDeps['fastify'] ? 'Fastify' : 'Koa';
        result.suggestedPlatform = 'railway';
      } else if (allDeps['nuxt']) {
        result.type = 'nuxt';
        result.framework = 'Nuxt';
        result.suggestedPlatform = 'vercel';
      }
    } catch { /* no package.json */ }

    // Check requirements.txt (Python)
    try {
      await fs.access(path.join(projectDir, 'requirements.txt'));
      result.hasRequirementsTxt = true;
      result.type = 'python-api';
      result.framework = 'Flask/FastAPI';
      result.suggestedPlatform = 'railway';
    } catch {}

    // Check Dockerfile
    try {
      await fs.access(path.join(projectDir, 'Dockerfile'));
      result.hasDockerfile = true;
      if (result.type === 'unknown') {
        result.type = 'docker';
        result.suggestedPlatform = 'railway';
      }
    } catch {}

    // Check for static HTML
    if (result.type === 'unknown') {
      try {
        await fs.access(path.join(projectDir, 'index.html'));
        result.type = 'static';
        result.framework = 'Static HTML';
        result.suggestedPlatform = 'netlify';
      } catch {}
    }
  } catch {}

  return result;
}

async function generateDeployConfig(projectDir, platform) {
  const configs = [];

  switch (platform) {
    case 'vercel':
      configs.push({
        file: 'vercel.json',
        content: JSON.stringify({
          "$schema": "https://openapi.vercel.sh/vercel.json",
          "buildCommand": "npm run build",
          "outputDirectory": "dist",
          "framework": null
        }, null, 2)
      });
      break;

    case 'netlify':
      configs.push({
        file: 'netlify.toml',
        content: `[build]\n  command = "npm run build"\n  publish = "dist"\n\n[[redirects]]\n  from = "/*"\n  to = "/index.html"\n  status = 200\n`
      });
      break;

    case 'railway':
      configs.push({
        file: 'Dockerfile',
        content: `FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nEXPOSE 3000\nCMD ["node", "index.js"]\n`
      });
      configs.push({
        file: 'railway.json',
        content: JSON.stringify({
          "$schema": "https://railway.app/railway.schema.json",
          "build": { "builder": "DOCKERFILE" },
          "deploy": { "restartPolicyType": "ON_FAILURE" }
        }, null, 2)
      });
      break;
  }

  // Write config files
  for (const config of configs) {
    const filePath = path.join(projectDir, config.file);
    await fs.writeFile(filePath, config.content, 'utf8');
  }

  return {
    platform,
    filesCreated: configs.map(c => c.file),
    nextStep: platform === 'vercel' ? 'npx vercel --prod'
      : platform === 'netlify' ? 'npx netlify deploy --prod'
      : 'railway up'
  };
}

module.exports = router;

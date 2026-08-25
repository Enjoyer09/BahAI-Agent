import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  CodebaseGraph,
  GroverOracle,
  DiffusionOperator,
  QuantumWalkEngine,
  QuantumRandomWalkSearch,
  quantumSearchCodebase,
  DEFAULT_CONFIG
} from '../chat/quantumSearch.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_DIR = join(process.cwd(), '.test-quantum-search');
const TEST_FILES = {
  'index.js': 'function main() { console.log("hello world"); }',
  'app.ts': 'export const app = express();',
  'utils.js': 'export function helper() { return "test"; }',
  'README.md': '# Project\nThis is a test project.',
  'config.json': '{"name": "test", "version": "1.0"}',
  'sub/deep.js': 'export const deep = "nested file";',
  'sub/utils.ts': 'export const utils = "typescript utils";',
  'other.py': 'def main(): print("python")'
};

function setupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, 'sub'), { recursive: true });
  
  for (const [file, content] of Object.entries(TEST_FILES)) {
    writeFileSync(join(TEST_DIR, file), content, 'utf8');
  }
}

function cleanupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

// ============================================================================
// CodebaseGraph Tests
// ============================================================================

describe('CodebaseGraph', () => {
  beforeEach(() => {
    setupTestDir();
  });
  
  afterEach(() => {
    cleanupTestDir();
  });
  
  it('builds graph from directory', async () => {
    const graph = new CodebaseGraph(TEST_DIR);
    await graph.build();
    
    expect(graph.nodeCount).toBeGreaterThan(0);
    expect(graph.nodes.size).toBeGreaterThan(0);
  });
  
  it('creates nodes for files', async () => {
    const graph = new CodebaseGraph(TEST_DIR);
    await graph.build();
    
    const nodes = graph.getAllNodes();
    const files = nodes.filter(n => n.type === 'file');
    
    expect(files.length).toBeGreaterThan(0);
  });
  
  it('creates nodes for directories', async () => {
    const graph = new CodebaseGraph(TEST_DIR);
    await graph.build();
    
    const nodes = graph.getAllNodes();
    const dirs = nodes.filter(n => n.type === 'directory');
    
    expect(dirs.length).toBeGreaterThan(0);
  });
  
  it('creates edges between parent and child', async () => {
    const graph = new CodebaseGraph(TEST_DIR);
    await graph.build();
    
    const rootId = graph.getNodeId(TEST_DIR);
    const neighbors = graph.getNeighbors(rootId);
    
    expect(neighbors.length).toBeGreaterThan(0);
  });
  
  it('respects ignore patterns', async () => {
    const graph = new CodebaseGraph(TEST_DIR, {
      ignorePatterns: ['sub']
    });
    await graph.build();
    
    const nodes = graph.getAllNodes();
    const hasSub = nodes.some(n => n.path.includes('sub'));
    
    expect(hasSub).toBe(false);
  });
  
  it('respects max depth', async () => {
    const graph = new CodebaseGraph(TEST_DIR, {
      maxDepth: 0
    });
    await graph.build();
    
    // Only root level files
    expect(graph.nodeCount).toBeLessThan(10);
  });
  
  it('generates correct node IDs', () => {
    const graph = new CodebaseGraph(TEST_DIR);
    
    const rootId = graph.getNodeId(TEST_DIR);
    expect(rootId).toBe('.');
    
    const fileId = graph.getNodeId(join(TEST_DIR, 'index.js'));
    expect(fileId).toBe('index.js');
  });
});

// ============================================================================
// GroverOracle Tests
// ============================================================================

describe('GroverOracle', () => {
  let graph;
  
  beforeEach(async () => {
    setupTestDir();
    graph = new CodebaseGraph(TEST_DIR);
    await graph.build();
  });
  
  afterEach(() => {
    cleanupTestDir();
  });
  
  it('marks matching files', () => {
    const oracle = new GroverOracle();
    const matches = oracle.apply(graph, 'main');
    
    expect(matches.size).toBeGreaterThan(0);
  });
  
  it('finds files by name', () => {
    const oracle = new GroverOracle();
    const matches = oracle.apply(graph, 'index.js', { searchContent: false });
    
    expect(matches.has('index.js')).toBe(true);
  });
  
  it('finds files by content', () => {
    const oracle = new GroverOracle();
    const matches = oracle.apply(graph, 'hello world', { searchFilenames: false });
    
    expect(matches.size).toBeGreaterThan(0);
  });
  
  it('returns empty for no matches', () => {
    const oracle = new GroverOracle();
    const matches = oracle.apply(graph, 'zzz_nonexistent_xyz');
    
    expect(matches.size).toBe(0);
  });
  
  it('checks if node is target', () => {
    const oracle = new GroverOracle();
    oracle.apply(graph, 'main');
    
    const hasTarget = Array.from(oracle.matches.keys()).some(id => oracle.isTarget(id));
    expect(hasTarget).toBe(true);
  });
  
  it('gets match score', () => {
    const oracle = new GroverOracle();
    const matches = oracle.apply(graph, 'index.js');
    
    for (const [nodeId, score] of matches) {
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
  
  it('handles case insensitive search', () => {
    const oracle = new GroverOracle();
    const matches = oracle.apply(graph, 'HELLO', { caseSensitive: false });
    
    expect(matches.size).toBeGreaterThan(0);
  });
});

// ============================================================================
// DiffusionOperator Tests
// ============================================================================

describe('DiffusionOperator', () => {
  let graph;
  let oracle;
  
  beforeEach(async () => {
    setupTestDir();
    graph = new CodebaseGraph(TEST_DIR);
    await graph.build();
    oracle = new GroverOracle();
    oracle.apply(graph, 'main');
  });
  
  afterEach(() => {
    cleanupTestDir();
  });
  
  it('amplifies target amplitudes', () => {
    const diffusion = new DiffusionOperator();
    
    // Get initial amplitudes of targets
    const initialAmplitudes = new Map();
    for (const nodeId of oracle.matches.keys()) {
      const node = graph.getNode(nodeId);
      if (node) initialAmplitudes.set(nodeId, node.amplitude);
    }
    
    // Apply diffusion
    diffusion.apply(graph, oracle);
    
    // Check that target amplitudes increased
    for (const [nodeId, initialAmp] of initialAmplitudes) {
      const node = graph.getNode(nodeId);
      if (node) {
        expect(node.amplitude).toBeGreaterThanOrEqual(initialAmp);
      }
    }
  });
  
  it('suppresses non-target amplitudes', () => {
    const diffusion = new DiffusionOperator();
    
    // Get initial amplitudes of non-targets
    const initialAmplitudes = new Map();
    for (const [nodeId, node] of graph.nodes) {
      if (!oracle.isTarget(nodeId)) {
        initialAmplitudes.set(nodeId, node.amplitude);
      }
    }
    
    // Apply diffusion
    diffusion.apply(graph, oracle);
    
    // Check that non-target amplitudes decreased (or stayed low)
    let decreasedCount = 0;
    for (const [nodeId, initialAmp] of initialAmplitudes) {
      const node = graph.getNode(nodeId);
      if (node && node.amplitude < initialAmp) {
        decreasedCount++;
      }
    }
    
    // At least some non-targets should have decreased
    expect(decreasedCount).toBeGreaterThan(0);
  });
  
  it('normalizes amplitudes', () => {
    const diffusion = new DiffusionOperator();
    diffusion.apply(graph, oracle);
    
    const nodes = graph.getAllNodes();
    const total = nodes.reduce((sum, n) => sum + n.amplitude, 0);
    
    // Total should be approximately equal to node count
    expect(total).toBeCloseTo(nodes.length, 0);
  });
});

// ============================================================================
// QuantumWalkEngine Tests
// ============================================================================

describe('QuantumWalkEngine', () => {
  let graph;
  
  beforeEach(async () => {
    setupTestDir();
    graph = new CodebaseGraph(TEST_DIR);
    await graph.build();
  });
  
  afterEach(() => {
    cleanupTestDir();
  });
  
  it('searches and returns results', () => {
    const engine = new QuantumWalkEngine();
    const results = engine.search(graph, 'main');
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBeDefined();
    expect(results[0].score).toBeGreaterThan(0);
  });
  
  it('returns empty for no matches', () => {
    const engine = new QuantumWalkEngine();
    const results = engine.search(graph, 'zzz_nonexistent_xyz');
    
    expect(results.length).toBe(0);
  });
  
  it('sorts results by score', () => {
    const engine = new QuantumWalkEngine();
    const results = engine.search(graph, 'export');
    
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });
  
  it('limits results', () => {
    const engine = new QuantumWalkEngine();
    const results = engine.search(graph, 'function', { maxResults: 2 });
    
    expect(results.length).toBeLessThanOrEqual(2);
  });
  
  it('performs walk step', () => {
    const engine = new QuantumWalkEngine();
    
    // Get initial amplitudes
    const initial = new Map();
    for (const [id, node] of graph.nodes) {
      initial.set(id, node.amplitude);
    }
    
    // Walk step
    engine.walkStep(graph);
    
    // Amplitudes should change (distributed to neighbors)
    let changed = false;
    for (const [id, node] of graph.nodes) {
      if (Math.abs(node.amplitude - initial.get(id)) > 0.001) {
        changed = true;
        break;
      }
    }
    
    expect(changed).toBe(true);
  });
});

// ============================================================================
// QuantumRandomWalkSearch Tests
// ============================================================================

describe('QuantumRandomWalkSearch', () => {
  afterEach(() => {
    cleanupTestDir();
  });
  
  it('builds graph and searches', async () => {
    setupTestDir();
    const searcher = new QuantumRandomWalkSearch(TEST_DIR);
    const result = await searcher.search('main');
    
    expect(result.query).toBe('main');
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.totalFiles).toBeGreaterThan(0);
    expect(result.searchTime).toBeGreaterThanOrEqual(0);
  });
  
  it('provides complexity info', async () => {
    setupTestDir();
    const searcher = new QuantumRandomWalkSearch(TEST_DIR);
    const result = await searcher.search('test');
    
    expect(result.complexity.classical).toBeGreaterThan(0);
    expect(result.complexity.quantum).toBeGreaterThan(0);
    expect(parseFloat(result.complexity.speedup)).toBeGreaterThan(1);
  });
  
  it('quickSearch works', async () => {
    setupTestDir();
    const result = await QuantumRandomWalkSearch.quickSearch(TEST_DIR, 'hello');
    
    expect(result).toBeDefined();
    expect(result.results.length).toBeGreaterThan(0);
  });
  
  it('gets stats after build', async () => {
    setupTestDir();
    const searcher = new QuantumRandomWalkSearch(TEST_DIR);
    await searcher.buildGraph();
    
    const stats = searcher.getStats();
    
    expect(stats).toBeDefined();
    expect(stats.totalNodes).toBeGreaterThan(0);
    expect(stats.files).toBeGreaterThan(0);
    expect(stats.directories).toBeGreaterThan(0);
  });
  
  it('handles empty query', async () => {
    setupTestDir();
    const searcher = new QuantumRandomWalkSearch(TEST_DIR);
    const result = await searcher.search('');
    
    expect(result.results.length).toBe(0);
  });
});

// ============================================================================
// quantumSearchCodebase Integration Tests
// ============================================================================

describe('quantumSearchCodebase', () => {
  afterEach(() => {
    cleanupTestDir();
  });
  
  it('returns search results', async () => {
    setupTestDir();
    const result = await quantumSearchCodebase(TEST_DIR, 'main');
    
    expect(result).toBeDefined();
    expect(result.results.length).toBeGreaterThan(0);
  });
  
  it('returns null when disabled', async () => {
    const result = await quantumSearchCodebase('/nonexistent', 'test', { enabled: false });
    
    expect(result).toBeNull();
  });
  
  it('handles search options', async () => {
    setupTestDir();
    const result = await quantumSearchCodebase(TEST_DIR, 'main', {
      searchContent: true,
      searchFilenames: true,
      maxResults: 5,
      caseSensitive: false
    });
    
    expect(result).toBeDefined();
    expect(result.results.length).toBeLessThanOrEqual(5);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Quantum Search Edge Cases', () => {
  afterEach(() => {
    cleanupTestDir();
  });
  
  it('handles non-existent directory', async () => {
    const searcher = new QuantumRandomWalkSearch('/nonexistent/path');
    const result = await searcher.search('test');
    
    expect(result.results.length).toBe(0);
  });
  
  it('handles special characters in query', async () => {
    setupTestDir();
    const searcher = new QuantumRandomWalkSearch(TEST_DIR);
    const result = await searcher.search('function(){}');
    
    expect(result).toBeDefined();
  });
  
  it('handles very long query', async () => {
    setupTestDir();
    const searcher = new QuantumRandomWalkSearch(TEST_DIR);
    const longQuery = 'a'.repeat(1000);
    const result = await searcher.search(longQuery);
    
    expect(result).toBeDefined();
  });
});

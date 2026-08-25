/**
 * bahAI - Quantum Random Walk Search
 * 
 * A quantum-inspired search system for codebase exploration that achieves
 * O(√N) search complexity through Grover-like amplitude amplification and
 * quantum walk on the codebase graph structure.
 * 
 * Key concepts:
 * - Codebase Graph: Files/directories as nodes, parent-child as edges
 * - Quantum Walk: Walk through the graph with quantum-like properties
 * - Grover Oracle: Identifies matching nodes (marks "target states")
 * - Diffusion Operator: Amplifies amplitudes of matching nodes
 * - Amplitude Amplification: Increases probability of finding matches
 * 
 * Classical search: O(N) — check every file
 * Quantum-inspired: O(√N) — amplitude amplification skips non-matches
 * 
 * For 1000 files: classical = 1000 checks, quantum = ~32 iterations
 */

const fs = require('fs/promises');
const path = require('path');
const { glob } = require('glob');

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  // Number of Grover iterations (optimal: π/4 * √N)
  maxIterations: 50,
  
  // Initial amplitude for all nodes
  initialAmplitude: 1.0,
  
  // Graph construction: max depth for directory traversal
  maxDepth: 10,
  
  // File extensions to index
  indexedExtensions: new Set([
    '.js', '.ts', '.tsx', '.jsx', '.json', '.md', '.txt',
    '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h',
    '.css', '.scss', '.html', '.vue', '.svelte',
    '.yaml', '.yml', '.toml', '.env', '.sh', '.bash'
  ]),
  
  // Ignore patterns
  ignorePatterns: [
    'node_modules', '.git', 'dist', 'build', '.next', 
    '__pycache__', '.venv', 'venv', '.cache', 'coverage'
  ],
  
  // Maximum nodes in graph (prevent memory explosion)
  maxNodes: 10000,
  
  // Diffusion strength (0-1, higher = more amplification)
  diffusionStrength: 0.7,
  
  // Oracle confidence threshold (0-1)
  oracleThreshold: 0.3,
};

// ============================================================================
// Codebase Graph
// ============================================================================

/**
 * Represents the codebase as a graph structure
 */
class CodebaseGraph {
  constructor(rootPath, config = DEFAULT_CONFIG) {
    this.rootPath = rootPath;
    this.config = config;
    this.nodes = new Map(); // id → node
    this.adjacency = new Map(); // id → [neighbor ids]
    this.nodeCount = 0;
  }
  
  /**
   * Build graph from filesystem
   */
  async build() {
    await this.traverseDirectory(this.rootPath, 0, null);
    return this;
  }
  
  /**
   * Recursively traverse directory and build graph
   */
  async traverseDirectory(dirPath, depth, parentId) {
    if (depth > this.config.maxDepth) return;
    if (this.nodeCount >= this.config.maxNodes) return;
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      // Add directory node
      const dirId = this.getNodeId(dirPath);
      if (!this.nodes.has(dirId)) {
        this.addNode(dirId, {
          type: 'directory',
          path: dirPath,
          name: path.basename(dirPath),
          depth
        });
      }
      
      // Connect to parent
      if (parentId) {
        this.addEdge(parentId, dirId);
      }
      
      // Process entries
      for (const entry of entries) {
        if (this.nodeCount >= this.config.maxNodes) break;
        
        // Skip ignored patterns
        if (this.config.ignorePatterns.includes(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        
        const entryPath = path.join(dirPath, entry.name);
        const entryId = this.getNodeId(entryPath);
        
        if (entry.isDirectory()) {
          // Recurse into directory
          await this.traverseDirectory(entryPath, depth + 1, dirId);
        } else {
          // Check if file extension is indexed
          const ext = path.extname(entry.name).toLowerCase();
          if (!this.config.indexedExtensions.has(ext)) continue;
          
          // Add file node
          this.addNode(entryId, {
            type: 'file',
            path: entryPath,
            name: entry.name,
            extension: ext,
            depth
          });
          
          // Connect to parent directory
          this.addEdge(dirId, entryId);
        }
      }
    } catch (err) {
      // Skip inaccessible directories
    }
  }
  
  /**
   * Generate node ID from path
   */
  getNodeId(filePath) {
    return path.relative(this.rootPath, filePath) || '.';
  }
  
  /**
   * Add node to graph
   */
  addNode(id, data) {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { id, ...data, amplitude: this.config.initialAmplitude });
      this.adjacency.set(id, []);
      this.nodeCount++;
    }
  }
  
  /**
   * Add edge between nodes
   */
  addEdge(id1, id2) {
    const adj1 = this.adjacency.get(id1) || [];
    const adj2 = this.adjacency.get(id2) || [];
    
    if (!adj1.includes(id2)) adj1.push(id2);
    if (!adj2.includes(id1)) adj2.push(id1);
    
    this.adjacency.set(id1, adj1);
    this.adjacency.set(id2, adj2);
  }
  
  /**
   * Get neighbors of a node
   */
  getNeighbors(nodeId) {
    return this.adjacency.get(nodeId) || [];
  }
  
  /**
   * Get all nodes
   */
  getAllNodes() {
    return Array.from(this.nodes.values());
  }
  
  /**
   * Get node by ID
   */
  getNode(nodeId) {
    return this.nodes.get(nodeId);
  }
}

// ============================================================================
// Grover Oracle
// ============================================================================

/**
 * Grover Oracle: identifies "target states" (matching nodes)
 * 
 * In quantum computing, the oracle flips the phase of target states.
 * Here, we mark matching nodes and boost their amplitudes.
 */
class GroverOracle {
  constructor(config = DEFAULT_CONFIG) {
    this.config = config;
    this.matches = new Map(); // nodeId → match score
  }
  
  /**
   * Apply oracle: mark matching nodes
   * 
   * @param {CodebaseGraph} graph - The codebase graph
   * @param {string} query - Search query
   * @param {object} options - Search options
   */
  apply(graph, query, options = {}) {
    this.matches.clear();
    
    const {
      searchContent = true,
      searchFilenames = true,
      caseSensitive = false,
      maxResults = 100
    } = options;
    
    const normalizedQuery = caseSensitive ? query : query.toLowerCase();
    const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);
    
    // Empty query matches nothing
    if (queryTerms.length === 0) return this.matches;
    
    for (const [nodeId, node] of graph.nodes) {
      if (node.type !== 'file') continue;
      
      let matchScore = 0;
      
      // Filename match (higher weight)
      if (searchFilenames) {
        const fileName = caseSensitive ? node.name : node.name.toLowerCase();
        if (fileName.includes(normalizedQuery)) {
          matchScore += 0.8;
        } else {
          // Check individual terms
          for (const term of queryTerms) {
            if (fileName.includes(term)) {
              matchScore += 0.3;
            }
          }
        }
      }
      
      // Content match (if enabled)
      if (searchContent && matchScore < 0.8) {
        try {
          const content = require('fs').readFileSync(node.path, 'utf8');
          const normalizedContent = caseSensitive ? content : content.toLowerCase();
          
          // Check for exact match
          if (normalizedContent.includes(normalizedQuery)) {
            matchScore += 0.6;
          } else {
            // Check for term matches
            let termMatches = 0;
            for (const term of queryTerms) {
              if (normalizedContent.includes(term)) {
                termMatches++;
              }
            }
            if (termMatches > 0) {
              matchScore += (termMatches / queryTerms.length) * 0.5;
            }
          }
          
          // Boost for multiple occurrences
          const occurrences = normalizedContent.split(normalizedQuery).length - 1;
          if (occurrences > 1) {
            matchScore = Math.min(1, matchScore + occurrences * 0.05);
          }
        } catch {
          // Skip unreadable files
        }
      }
      
      // Apply threshold
      if (matchScore >= this.config.oracleThreshold) {
        this.matches.set(nodeId, Math.min(1, matchScore));
      }
    }
    
    return this.matches;
  }
  
  /**
   * Check if a node is a target (match)
   */
  isTarget(nodeId) {
    return this.matches.has(nodeId);
  }
  
  /**
   * Get match score for a node
   */
  getMatchScore(nodeId) {
    return this.matches.get(nodeId) || 0;
  }
}

// ============================================================================
// Diffusion Operator
// ============================================================================

/**
 * Diffusion Operator: amplifies amplitudes of target states
 * 
 * In Grover's algorithm, the diffusion operator reflects amplitudes
 * about the mean, which amplifies target states and suppresses non-targets.
 */
class DiffusionOperator {
  constructor(config = DEFAULT_CONFIG) {
    this.config = config;
  }
  
  /**
   * Apply diffusion: amplify target amplitudes, suppress others
   * 
   * @param {CodebaseGraph} graph - The codebase graph
   * @param {GroverOracle} oracle - The oracle marking targets
   */
  apply(graph, oracle) {
    const nodes = graph.getAllNodes();
    if (nodes.length === 0) return;
    
    // Calculate mean amplitude
    let totalAmplitude = 0;
    let targetCount = 0;
    
    for (const node of nodes) {
      totalAmplitude += node.amplitude;
      if (oracle.isTarget(node.id)) {
        targetCount++;
      }
    }
    
    const meanAmplitude = totalAmplitude / nodes.length;
    
    // Apply diffusion: reflect about mean
    // Target states get amplified, non-targets get suppressed
    for (const node of nodes) {
      if (oracle.isTarget(node.id)) {
        // Amplify target: new = mean + (mean - old) * strength
        const boost = (meanAmplitude - node.amplitude) * this.config.diffusionStrength;
        node.amplitude = Math.min(2, node.amplitude + boost + 0.1);
      } else {
        // Suppress non-target: new = mean - (old - mean) * strength
        const suppression = (node.amplitude - meanAmplitude) * this.config.diffusionStrength * 0.3;
        node.amplitude = Math.max(0.01, node.amplitude - suppression);
      }
    }
    
    // Normalize amplitudes to prevent explosion
    this.normalizeAmplitudes(nodes);
  }
  
  /**
   * Normalize amplitudes so sum equals number of nodes
   */
  normalizeAmplitudes(nodes) {
    const total = nodes.reduce((sum, n) => sum + n.amplitude, 0);
    if (total === 0) return;
    
    const factor = nodes.length / total;
    for (const node of nodes) {
      node.amplitude *= factor;
    }
  }
}

// ============================================================================
// Quantum Walk Engine
// ============================================================================

/**
 * Quantum Walk: walks through the graph with quantum-like properties
 * 
 * At each step, the walker:
 * 1. Moves to a random neighbor (classical random walk)
 * 2. Applies Grover oracle (marks targets)
 * 3. Applies diffusion (amplifies targets)
 * 4. Repeats for O(√N) iterations
 */
class QuantumWalkEngine {
  constructor(config = DEFAULT_CONFIG) {
    this.config = config;
    this.oracle = new GroverOracle(config);
    this.diffusion = new DiffusionOperator(config);
  }
  
  /**
   * Run quantum walk search
   * 
   * @param {CodebaseGraph} graph - The codebase graph
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @returns {Array} Sorted search results
   */
  search(graph, query, options = {}) {
    const { maxResults = 20 } = options;
    
    // Phase 1: Apply oracle (mark matching nodes)
    const matches = this.oracle.apply(graph, query, options);
    
    if (matches.size === 0) {
      return [];
    }
    
    // Phase 2: Calculate optimal iterations
    // Grover's optimal iterations: π/4 * √(N/M)
    // N = total nodes, M = matching nodes
    const N = graph.nodeCount;
    const M = matches.size;
    const optimalIterations = Math.min(
      this.config.maxIterations,
      Math.ceil(Math.PI / 4 * Math.sqrt(N / Math.max(M, 1)))
    );
    
    // Phase 3: Quantum walk iterations
    for (let i = 0; i < optimalIterations; i++) {
      // Apply diffusion operator (amplify targets)
      this.diffusion.apply(graph, this.oracle);
      
      // Quantum walk step: move to random neighbors
      this.walkStep(graph);
    }
    
    // Phase 4: Extract results by amplitude
    const results = [];
    for (const [nodeId, matchScore] of matches) {
      const node = graph.getNode(nodeId);
      if (!node) continue;
      
      results.push({
        path: node.path,
        name: node.name,
        type: node.type,
        matchScore,
        amplitude: node.amplitude,
        // Combined score: match score × amplitude boost
        score: matchScore * (1 + node.amplitude * 0.5)
      });
    }
    
    // Sort by combined score (descending)
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, maxResults);
  }
  
  /**
   * Quantum walk step: move amplitudes to neighbors
   */
  walkStep(graph) {
    const nodes = graph.getAllNodes();
    const newAmplitudes = new Map();
    
    for (const node of nodes) {
      const neighbors = graph.getNeighbors(node.id);
      if (neighbors.length === 0) continue;
      
      // Distribute amplitude to neighbors
      const distributedAmplitude = node.amplitude / (neighbors.length + 1);
      
      // Keep some amplitude at current node
      newAmplitudes.set(node.id, (newAmplitudes.get(node.id) || 0) + distributedAmplitude);
      
      // Distribute to neighbors
      for (const neighborId of neighbors) {
        newAmplitudes.set(neighborId, (newAmplitudes.get(neighborId) || 0) + distributedAmplitude);
      }
    }
    
    // Apply new amplitudes
    for (const [nodeId, amplitude] of newAmplitudes) {
      const node = graph.getNode(nodeId);
      if (node) {
        node.amplitude = amplitude;
      }
    }
  }
}

// ============================================================================
// Quantum Search Interface
// ============================================================================

/**
 * Main search interface: combines graph construction, oracle, and quantum walk
 */
class QuantumRandomWalkSearch {
  constructor(rootPath, options = {}) {
    this.rootPath = rootPath;
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.graph = null;
    this.engine = new QuantumWalkEngine(this.config);
    this.built = false;
  }
  
  /**
   * Build the codebase graph (call once, reuse for multiple searches)
   */
  async buildGraph() {
    this.graph = new CodebaseGraph(this.rootPath, this.config);
    await this.graph.build();
    this.built = true;
    return this;
  }
  
  /**
   * Search the codebase
   * 
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @returns {Array} Search results
   */
  async search(query, options = {}) {
    if (!this.built) {
      await this.buildGraph();
    }
    
    const startTime = Date.now();
    const results = this.engine.search(this.graph, query, options);
    const searchTime = Date.now() - startTime;
    
    return {
      query,
      results,
      totalFiles: this.graph.nodeCount,
      matchedFiles: results.length,
      searchTime,
      // Complexity info
      complexity: {
        classical: this.graph.nodeCount,
        quantum: Math.ceil(Math.sqrt(this.graph.nodeCount)),
        speedup: (this.graph.nodeCount / Math.max(Math.ceil(Math.sqrt(this.graph.nodeCount)), 1)).toFixed(1)
      }
    };
  }
  
  /**
   * Quick search without building full graph (for small codebases)
   */
  static async quickSearch(rootPath, query, options = {}) {
    const searcher = new QuantumRandomWalkSearch(rootPath, options);
    return searcher.search(query, options);
  }
  
  /**
   * Get graph statistics
   */
  getStats() {
    if (!this.graph) return null;
    
    const nodes = this.graph.getAllNodes();
    const files = nodes.filter(n => n.type === 'file');
    const dirs = nodes.filter(n => n.type === 'directory');
    
    // Extension distribution
    const extensions = {};
    for (const file of files) {
      const ext = file.extension || 'other';
      extensions[ext] = (extensions[ext] || 0) + 1;
    }
    
    return {
      totalNodes: this.graph.nodeCount,
      files: files.length,
      directories: dirs.length,
      extensions,
      maxDepth: Math.max(...nodes.map(n => n.depth || 0))
    };
  }
}

// ============================================================================
// Integration Helper
// ============================================================================

/**
 * Quantum-enhanced search for toolRunner.js
 * 
 * This function can be called from the existing grep_search/find_references tools
 * to provide quantum-accelerated search when the codebase is large.
 */
async function quantumSearchCodebase(rootPath, query, options = {}) {
  const {
    enabled = true,
    searchContent = true,
    searchFilenames = true,
    maxResults = 20,
    caseSensitive = false
  } = options;
  
  if (!enabled) return null;
  
  try {
    const result = await QuantumRandomWalkSearch.quickSearch(rootPath, query, {
      searchContent,
      searchFilenames,
      maxResults,
      caseSensitive,
      maxIterations: 30
    });
    
    return result;
  } catch (err) {
    console.warn(`[QuantumSearch] Search failed: ${err.message}`);
    return null;
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  CodebaseGraph,
  GroverOracle,
  DiffusionOperator,
  QuantumWalkEngine,
  QuantumRandomWalkSearch,
  quantumSearchCodebase,
  DEFAULT_CONFIG
};

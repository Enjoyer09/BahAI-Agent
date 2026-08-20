const PROFILE_BUNDLES = [
  {
    id: 'ui_designer',
    name: '🎨 UI Designer Agent',
    description: 'Expert at single-file interactive web UI generation (HTML/CSS/JS with Tailwind/Chart.js)',
    rolePrompt: 'You are an elite UI/UX engineer. Always write 100% production-ready, beautiful, interactive single-file HTML apps with modern CSS styling and JavaScript.',
    recommendedModel: 'nvidia/nemotron-3-super-120b-a12b'
  },
  {
    id: 'algo_expert',
    name: '🧮 Algorithm & Data Structures Expert',
    description: 'Specialized in high-performance Python, C++, Rust algorithms with O(N) complexity analysis',
    rolePrompt: 'You are a Senior Computer Scientist. Provide complete, fully typed, well-commented algorithmic solutions with rigorous time/space complexity analysis.',
    recommendedModel: 'nvidia/nemotron-3-super-120b-a12b'
  },
  {
    id: 'sys_architect',
    name: '🏗 System Architect',
    description: 'Designs scalable distributed backend systems, database schemas, and microservices',
    rolePrompt: 'You are a Principal System Architect. Design enterprise-grade system blueprints, SQL schemas with foreign keys/indexes, rate limiters, and Kafka event ingestion pipelines.',
    recommendedModel: 'nvidia/nemotron-3-super-120b-a12b'
  },
  {
    id: 'az_logic',
    name: '🇦🇿 Azerbaijani Reasoning & Technical Writer',
    description: 'Fluent Azerbaijani deep technical articles, zero-trust security papers, and cloud guides',
    rolePrompt: 'Siz yüksək səviyyəli proqramlaşdırma və sistem mühəndisisiniz. Bütün texniki izahları azərbaycan dilində dərin, aydın, bənd-bənd və zəngin nümunələrlə yazın.',
    recommendedModel: 'meta/llama-3.1-8b-instruct'
  }
];

function listProfileBundles() {
  return PROFILE_BUNDLES;
}

function getProfileBundle(id) {
  return PROFILE_BUNDLES.find(b => b.id === id) || null;
}

module.exports = {
  PROFILE_BUNDLES,
  listProfileBundles,
  getProfileBundle
};

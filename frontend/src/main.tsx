import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import App from './App.tsx'
import { AuthProvider } from './hooks/useAuth.tsx'
import { initMonitoring } from './lib/monitoring'

// P2-FIX: Initialize monitoring early, before any React rendering
initMonitoring({
  environment: import.meta.env.MODE,
  enabled: import.meta.env.PROD, // Only active in production builds
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)

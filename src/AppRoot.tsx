import { StrictMode } from 'react'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

// GitHub Pages deep links are restored in main.tsx (restoreGhPagesRoute) before this renders.
export function AppRoot() {
  return (
    <StrictMode>
      <ErrorBoundary>
        <HashRouter>
          <App />
        </HashRouter>
      </ErrorBoundary>
    </StrictMode>
  )
}

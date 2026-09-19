import { StrictMode, useEffect } from 'react'
import { HashRouter } from 'react-router-dom'
import App from './App'

export function AppRoot() {
  useEffect(() => {
    const redirect = sessionStorage.getItem('ghpages-redirect')
    if (redirect) {
      sessionStorage.removeItem('ghpages-redirect')
      // optional: map path redirects if we ever leave hash mode
    }
  }, [])

  return (
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>
  )
}

import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-700.css'
import './index.css'
import { AppRoot } from './AppRoot'
import { restoreGhPagesRoute } from './lib/ghPagesRedirect'

// Before the router reads the address: a deep link that GitHub Pages sent through 404.html.
restoreGhPagesRoute()

createRoot(document.getElementById('root')!).render(<AppRoot />)

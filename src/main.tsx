import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/public-sans/400.css'
import '@fontsource/public-sans/600.css'
import '@fontsource/newsreader/400.css'
import '@fontsource/newsreader/600.css'
import './app/tokens.css'
import './app/global.css'
import { ThemeProvider } from './features/theme/ThemeProvider'
import { App } from './app/App'
import { startOffline } from './features/offline/startOffline'

createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider><App /></ThemeProvider></React.StrictMode>)
startOffline()

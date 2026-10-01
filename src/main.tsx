import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/source-sans-3/400.css'
import '@fontsource/source-sans-3/600.css'
import '@fontsource/source-serif-4/600.css'
import './app/tokens.css'
import './app/global.css'
import { ThemeProvider } from './features/theme/ThemeProvider'
import { App } from './app/App'

createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider><App /></ThemeProvider></React.StrictMode>)

import '@fontsource-variable/dm-sans'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './style.css'
import { mountPlayground } from './playground/template'
import { startPlayground } from './playground/controller'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('Missing application root.')
mountPlayground(root)
startPlayground()

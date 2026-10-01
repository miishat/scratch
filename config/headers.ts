import { readFileSync } from 'node:fs'

// Reads one block of a Netlify/Cloudflare style _headers file: the header lines
// indented under the given path. `public/_headers` is the single source of the
// policy; the preview server and the policy test both read it from here.
export function readHeaderBlock(file: string, path: string): Record<string, string> {
  const headers: Record<string, string> = {}
  let inBlock = false
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) { inBlock = line.trim() === path; continue }
    if (!inBlock) continue
    const colon = line.indexOf(':')
    headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return headers
}

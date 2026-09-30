// Copies the JSON the fetcher commits into the site's public directory so the
// app can load it at runtime. Runs automatically before `dev` and `build`.
import { cp, mkdir, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, '..', '..', 'data')
const target = join(here, '..', 'public', 'data')

const files = ['monthly.json', 'weekly.json', 'daily.json', 'positioning.json', 'meta.json']

await mkdir(target, { recursive: true })

let copied = 0
for (const file of files) {
  const from = join(source, file)
  try {
    await access(from)
  } catch {
    console.warn(`[sync-data] ${file} not found in /data — skipping`)
    continue
  }
  await cp(from, join(target, file))
  copied += 1
}

if (copied === 0) {
  console.warn('[sync-data] No data files found in /data.')
  console.warn('            Run: python fetcher/fetch.py')
} else {
  console.log(`[sync-data] copied ${copied} file(s) into web/public/data`)
}

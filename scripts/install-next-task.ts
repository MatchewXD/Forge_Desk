// Installs the user-level /next-task command so it works in every repo:
//   npm run install:next-task
// Copies tools/claude-code/next-task.md -> ~/.claude/commands/next-task.md (overwrites).
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const src = resolve(import.meta.dirname, '../tools/claude-code/next-task.md')
const destDir = join(homedir(), '.claude', 'commands')
const dest = join(destDir, 'next-task.md')

mkdirSync(destDir, { recursive: true })
copyFileSync(src, dest)
if (readFileSync(dest, 'utf8') !== readFileSync(src, 'utf8')) throw new Error('copy verification failed')
console.log(`Installed /next-task -> ${dest}`)

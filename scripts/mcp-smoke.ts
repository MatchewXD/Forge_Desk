// End-to-end test of the MCP server over stdio, against a temporary database:
//   npm run test:mcp
// Spawns src/mcp/server.ts exactly as Claude would and calls every tool.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { toLocalDateString } from '../src/shared/db/dates.ts'

const dir = mkdtempSync(join(tmpdir(), 'forge-desk-mcp-'))
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(import.meta.dirname, '../src/mcp/server.ts')],
  env: { ...process.env, FORGE_DESK_DB: join(dir, 'test.db') } as Record<string, string>,
  stderr: 'ignore'
})
const client = new Client({ name: 'forge-desk-smoke', version: '0.0.0' })

async function call<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean
    content: { type: string; text: string }[]
  }
  if (res.isError) throw new Error(res.content[0].text)
  return JSON.parse(res.content[0].text) as T
}

try {
  await client.connect(transport)
  const tools = (await client.listTools()).tools.map((t) => t.name).sort()
  assert.deepEqual(tools, [
    'complete_task',
    'create_task',
    'get_task',
    'get_today',
    'list_tasks',
    'move_task',
    'update_task'
  ])

  const today = toLocalDateString()
  const vision = await call('create_task', { title: 'Vision' })
  assert.equal(vision.level, 'vision')
  const project = await call('create_task', { title: 'Project', parent_id: vision.id })
  const ms1 = await call('create_task', { title: 'M1', parent_id: project.id })
  const ms2 = await call('create_task', { title: 'M2', parent_id: project.id })
  const task = await call('create_task', { title: 'Task', parent_id: ms1.id })
  assert.equal(task.level, 'task')

  const updated = await call('update_task', { id: task.id, deadline: today, priority: 'high', status: 'in_progress' })
  assert.equal(updated.deadline, today)
  assert.equal(updated.priority, 'high')

  const agenda = await call('get_today')
  assert.deepEqual(agenda.dueToday.map((t: any) => t.title), ['Task'])
  assert.deepEqual(agenda.dueToday[0].path, ['Vision', 'Project', 'M1'])

  const moved = await call('move_task', { id: task.id, new_parent_id: ms2.id })
  assert.equal(moved.parentId, ms2.id)

  const done = await call('complete_task', { id: task.id })
  assert.equal(done.status, 'done')

  const detail = await call('get_task', { id: ms2.id })
  assert.equal(detail.task.progress, 1)
  assert.deepEqual(detail.ancestors.map((a: any) => a.title), ['Vision', 'Project'])

  const [root] = await call('list_tasks', { tree: true })
  assert.equal(root.progress, 0.5) // M1 (empty, 0) + M2 (100%)
  const flat = await call('list_tasks', { level: 'milestone' })
  assert.equal(flat.length, 2)

  // Repository rules surface as tool errors
  await assert.rejects(call('create_task', { title: 'Bad', parent_id: vision.id, level: 'task' }), /must be a project/)
  await assert.rejects(call('move_task', { id: task.id, new_parent_id: project.id }), /only be moved under a milestone/)
  await assert.rejects(call('get_task', { id: 9999 }), /not found/)

  console.log('mcp-smoke: all checks passed')
} finally {
  await client.close()
  rmSync(dir, { recursive: true, force: true })
}

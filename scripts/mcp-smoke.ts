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
  env: { ...process.env, FORGE_DESK_DB: join(dir, 'test.db'), FORGE_DESK_AGENT: 'claude-code' } as Record<
    string,
    string
  >,
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
    'add_note',
    'complete_task',
    'create_task',
    'get_task',
    'get_today',
    'list_notes',
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

  // Active / completed views
  const active = await call('list_tasks', { tree: true, view: 'active' })
  assert.ok(!JSON.stringify(active).includes('"title":"Task"'))
  const archive = await call('list_tasks', { tree: true, view: 'completed' })
  assert.equal(archive[0].isContext, true)

  // Recurrence through create_task / update_task / complete_task
  const rec = await call('create_task', { title: 'Daily review', parent_id: ms1.id, recurrence: 'daily' })
  assert.equal(rec.recurrence, 'daily')
  assert.equal(rec.deadline, today)
  assert.equal((await call('get_today')).dueToday[0].title, 'Daily review')
  const next = await call('complete_task', { id: rec.id })
  assert.equal(next.status, 'todo')
  assert.notEqual(next.deadline, today)
  const recDetail = await call('get_task', { id: rec.id })
  assert.equal(recDetail.completions.length, 1)
  const weekly = await call('update_task', { id: rec.id, recurrence: 'weekly' })
  assert.equal(weekly.recurrence, 'weekly')
  assert.equal((await call('update_task', { id: rec.id, recurrence: null })).recurrence, null)
  await assert.rejects(call('update_task', { id: ms1.id, recurrence: 'daily' }), /Only tasks and micro-tasks/)

  // Assignee + review + notes (the Claude Code handoff loop)
  const handoff = await call('create_task', {
    title: 'Implement thing',
    parent_id: ms2.id,
    assignee: 'claude-code',
    priority: 'urgent',
    description: 'Spec here'
  })
  assert.equal(handoff.assignee, 'claude-code')
  const mine = await call('list_tasks', { assignee: 'claude-code', status: 'todo' })
  assert.deepEqual(mine.map((t: any) => t.id), [handoff.id])
  const ctxTree = await call('list_tasks', { tree: true, view: 'active', assignee: 'claude-code' })
  assert.equal(ctxTree[0].isContext, true)
  await call('update_task', { id: handoff.id, status: 'in_progress' })
  const note = await call('add_note', { id: handoff.id, text: 'Built on branch x' })
  assert.equal(note.author, 'claude-code') // from FORGE_DESK_AGENT
  assert.equal((await call('add_note', { id: handoff.id, text: 'hi', author: 'me' })).author, 'me')
  assert.equal((await call('update_task', { id: handoff.id, status: 'review' })).status, 'review')
  const notes = await call('list_notes', { id: handoff.id })
  assert.deepEqual(notes.map((n: any) => n.text), ['Built on branch x', 'hi'])
  assert.equal((await call('get_task', { id: handoff.id })).notes.length, 2)
  assert.equal((await call('update_task', { id: handoff.id, assignee: 'me' })).assignee, 'me')
  await assert.rejects(call('add_note', { id: 9999, text: 'x' }), /not found/)

  // repo_path on projects + scoping by project (what /next-task uses)
  assert.equal((await call('update_task', { id: project.id, repo_path: 'E:\\Coding\\Some_Repo' })).repoPath, 'E:\\Coding\\Some_Repo')
  const found = await call('list_tasks', { repo_path: 'E:/coding/some_repo' })
  assert.deepEqual(found.map((t: any) => t.id), [project.id])
  assert.equal((await call('get_task', { id: project.id })).task.repoPath, 'E:\\Coding\\Some_Repo')
  const proj2 = await call('create_task', { title: 'Second', parent_id: vision.id, repo_path: '/e/Coding/Other' })
  assert.equal(proj2.repoPath, '/e/Coding/Other')
  assert.deepEqual((await call('list_tasks', { repo_path: 'E:\\Coding\\Other\\' })).map((t: any) => t.id), [proj2.id])
  await assert.rejects(call('update_task', { id: ms1.id, repo_path: 'E:\\x' }), /Only projects have a repo path/)
  await assert.rejects(call('update_task', { id: proj2.id, repo_path: 'e:/coding/some_repo' }), /already used/)
  const scoped = await call('list_tasks', { under_id: project.id, assignee: 'me', status: 'todo' })
  assert.ok(scoped.length > 0 && scoped.every((t: any) => t.assignee === 'me'))
  assert.deepEqual(await call('list_tasks', { under_id: proj2.id }), [])
  assert.equal((await call('update_task', { id: proj2.id, repo_path: null })).repoPath, null)

  // Repository rules surface as tool errors
  await assert.rejects(call('create_task', { title: 'Bad', parent_id: vision.id, level: 'task' }), /must be a project/)
  await assert.rejects(call('move_task', { id: task.id, new_parent_id: project.id }), /only be moved under a milestone/)
  await assert.rejects(call('get_task', { id: 9999 }), /not found/)

  console.log('mcp-smoke: all checks passed')
} finally {
  await client.close()
  rmSync(dir, { recursive: true, force: true })
}

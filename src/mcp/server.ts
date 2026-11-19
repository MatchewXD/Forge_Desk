#!/usr/bin/env node
// Forge Desk MCP server (Phase 1.5).
// Exposes the task board to Claude over stdio. Every tool is a thin wrapper around
// TaskRepository — business rules live in src/shared/db, never here.
//
// Run:   node src/mcp/server.ts          (Node >= 22.18: native TypeScript + node:sqlite)
// DB:    %APPDATA%\ForgeDesk\forge-desk.db, or FORGE_DESK_DB to override.
//
// stdout is the MCP channel — log only to stderr.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  LEVELS,
  PRIORITIES,
  STATUSES,
  TaskRepository,
  defaultDbPath,
  openDatabase
} from '../shared/db/index.ts'

const dbPath = defaultDbPath()
const db = openDatabase(dbPath)
const repo = new TaskRepository(db)

const server = new McpServer({ name: 'forge-desk', version: '0.1.0' })

/** Run a repository call and return its result as JSON (or a tool error). */
function run(fn: () => unknown): CallToolResult {
  try {
    const result = fn()
    return { content: [{ type: 'text', text: JSON.stringify(result ?? { ok: true }, null, 2) }] }
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }] }
  }
}

// ---- shared schemas ----
const id = z.number().int().positive()
const level = z.enum(LEVELS)
const status = z.enum(STATUSES)
const priority = z.enum(PRIORITIES)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

const HIERARCHY =
  'Hierarchy (strict, one level per step): vision > project > milestone > task > microtask. ' +
  'Visions are top-level; every other item must have a parent exactly one level up.'

server.registerTool(
  'list_tasks',
  {
    title: 'List tasks',
    description:
      'List items on the Forge Desk task board. With tree=true returns the nested hierarchy with ' +
      'rolled-up progress (0..1) and leaf counts, optionally limited to the subtree under root_id. ' +
      'Otherwise returns a flat list filtered by the given fields. ' +
      HIERARCHY,
    inputSchema: {
      tree: z.boolean().optional().describe('Return the nested tree with progress instead of a flat list'),
      root_id: id.optional().describe('With tree=true: only the subtree under this item'),
      parent_id: id.nullable().optional().describe('Direct children of this item (null = top-level visions)'),
      level: level.optional(),
      status: z.union([status, z.array(status)]).optional(),
      due_before: date.optional().describe('Only items with a deadline on or before this date'),
      include_done: z.boolean().optional().describe('Include done items (default true)')
    },
    annotations: { readOnlyHint: true }
  },
  (a) =>
    run(() =>
      a.tree
        ? repo.getTree(a.root_id)
        : repo.listTasks({
            parentId: a.parent_id,
            level: a.level,
            status: a.status,
            dueOnOrBefore: a.due_before,
            includeDone: a.include_done
          })
    )
)

server.registerTool(
  'get_task',
  {
    title: 'Get task',
    description:
      'Get one item with its rolled-up progress, its ancestors (root first) and its full subtree of children.',
    inputSchema: { id },
    annotations: { readOnlyHint: true }
  },
  (a) => run(() => repo.getTaskDetail(a.id))
)

server.registerTool(
  'create_task',
  {
    title: 'Create task',
    description:
      'Create an item. Omit parent_id to create a vision. level is optional and inferred from the ' +
      'parent. ' +
      HIERARCHY,
    inputSchema: {
      title: z.string().min(1),
      parent_id: id.nullable().optional(),
      level: level.optional(),
      description: z.string().optional(),
      status: status.optional().describe('Default todo'),
      deadline: date.nullable().optional(),
      priority: priority.optional().describe('Default medium')
    }
  },
  (a) =>
    run(() =>
      repo.createTask({
        title: a.title,
        parentId: a.parent_id,
        level: a.level,
        description: a.description,
        status: a.status,
        deadline: a.deadline,
        priority: a.priority
      })
    )
)

server.registerTool(
  'update_task',
  {
    title: 'Update task',
    description:
      'Update fields of an item. Only the fields you pass change. Pass deadline=null to clear it. ' +
      'To change the parent or position use move_task.',
    inputSchema: {
      id,
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      status: status.optional(),
      deadline: date.nullable().optional(),
      priority: priority.optional()
    },
    annotations: { idempotentHint: true }
  },
  ({ id, ...patch }) => run(() => repo.updateTask(id, patch))
)

server.registerTool(
  'move_task',
  {
    title: 'Move task',
    description:
      'Move an item under a new parent (which must be exactly one level up) and/or to a position among ' +
      'its siblings (0 = first; omit for last). To reorder within the same parent, pass its current parent_id.',
    inputSchema: {
      id,
      new_parent_id: id.nullable().describe('null only for visions'),
      index: z.number().int().min(0).optional()
    }
  },
  (a) => run(() => repo.moveTask(a.id, a.new_parent_id, a.index))
)

server.registerTool(
  'complete_task',
  {
    title: 'Complete task',
    description:
      'Mark an item done. With cascade=true also marks all of its open descendants done ' +
      '(otherwise a parent stays below 100% progress until its children are done).',
    inputSchema: { id, cascade: z.boolean().optional() },
    annotations: { idempotentHint: true }
  },
  (a) => run(() => repo.completeTask(a.id, { cascade: a.cascade }))
)

server.registerTool(
  'get_today',
  {
    title: "Get today's agenda",
    description:
      'The Today screen: open items that are overdue, due today, and due in the next N days (default 7), ' +
      'each with its ancestor path. Uses the local date unless `today` is given.',
    inputSchema: {
      today: date.optional(),
      days: z.number().int().min(1).max(90).optional()
    },
    annotations: { readOnlyHint: true }
  },
  (a) => run(() => repo.getToday(a.today, a.days))
)

const shutdown = (): void => {
  try {
    db.close()
  } catch {
    /* already closed */
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.stdin.on('close', shutdown)

await server.connect(new StdioServerTransport())
console.error(`[forge-desk-mcp] ready — database: ${dbPath}`)

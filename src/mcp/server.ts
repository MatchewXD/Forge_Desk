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
  ASSIGNEES,
  LEVELS,
  PRIORITIES,
  RECURRENCES,
  STATUSES,
  TaskRepository,
  defaultDbPath,
  openDatabase
} from '../shared/db/index.ts'

// Who this server speaks for: authors notes when add_note gets no explicit author.
// Set FORGE_DESK_AGENT=claude-code in Claude Code's config; Claude Desktop uses the default.
const agentEnv = process.env.FORGE_DESK_AGENT
const AGENT = (ASSIGNEES as readonly string[]).includes(agentEnv ?? '') ? (agentEnv as (typeof ASSIGNEES)[number]) : 'claude'

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
const assignee = z
  .enum(ASSIGNEES)
  .describe("Who does the work: 'me' (the user), 'claude-code' (Claude Code in the repo) or 'claude' (Claude chat)")
const recurrence = z
  .enum(RECURRENCES)
  .nullable()
  .describe(
    'Repeat rule for tasks/micro-tasks: daily, weekdays (Mon-Fri) or weekly (same weekday). null = not recurring. ' +
      'Completing a recurring task logs the occurrence to the Completed archive and moves its deadline to the ' +
      'next occurrence; it never stays done. Without a deadline the first occurrence is due today.'
  )
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
      'rolled-up progress (0..1) and leaf counts, optionally limited to the subtree under root_id; ' +
      'view=active hides done items (like the Tasks page in the app), view=completed shows the archive with ' +
      'recurring-task completion logs; items only present to show hierarchy have isContext=true. ' +
      'Otherwise returns a flat list filtered by the given fields. ' +
      HIERARCHY,
    inputSchema: {
      tree: z.boolean().optional().describe('Return the nested tree with progress instead of a flat list'),
      root_id: id.optional().describe('With tree=true: only the subtree under this item'),
      view: z.enum(['all', 'active', 'completed']).optional().describe('With tree=true (default all)'),
      assignee: assignee.optional().describe('Only items assigned to this; with tree=true ancestors are kept as context'),
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
        ? repo.getTree({ rootId: a.root_id, view: a.view, assignee: a.assignee })
        : repo.listTasks({
            parentId: a.parent_id,
            level: a.level,
            status: a.status,
            dueOnOrBefore: a.due_before,
            includeDone: a.include_done,
            assignee: a.assignee
          })
    )
)

server.registerTool(
  'get_task',
  {
    title: 'Get task',
    description:
      'Get one item with its rolled-up progress, its ancestors (root first), its full subtree of children, ' +
      'its notes (oldest first) and, for recurring tasks, its log of completed occurrences. ' +
      'The description plus notes are the spec for the work.',
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
      priority: priority.optional().describe('Default medium'),
      recurrence: recurrence.optional(),
      assignee: assignee.optional().describe("Default 'me'")
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
        priority: a.priority,
        recurrence: a.recurrence,
        assignee: a.assignee
      })
    )
)

server.registerTool(
  'update_task',
  {
    title: 'Update task',
    description:
      'Update fields of an item. Only the fields you pass change. Pass deadline=null to clear it, ' +
      'recurrence=null to stop repeating. Setting status=done on a recurring task completes the current ' +
      'occurrence. Setting a done item back to todo/in_progress also reopens its done ancestors. ' +
      "status=review means the work is finished but waiting for the user to check it. " +
      'To change the parent or position use move_task.',
    inputSchema: {
      id,
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      status: status.optional(),
      deadline: date.nullable().optional(),
      priority: priority.optional(),
      recurrence: recurrence.optional(),
      assignee: assignee.optional()
    }
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
      'Mark an item done (it moves to the Completed archive). With cascade=true also marks all of its open ' +
      'descendants done (otherwise a parent stays below 100% progress until its children are done). ' +
      'For a recurring task this logs the occurrence, resets it and its sub-items to todo, and returns it ' +
      'with the next deadline — call once per occurrence.',
    inputSchema: { id, cascade: z.boolean().optional() }
  },
  (a) => run(() => repo.completeTask(a.id, { cascade: a.cascade }))
)

server.registerTool(
  'add_note',
  {
    title: 'Add note',
    description:
      'Append a note to an item (an append-only log: notes cannot be edited or deleted). Use it for progress ' +
      'reports, questions and handoff details. Markdown is fine.',
    inputSchema: {
      id,
      text: z.string().min(1),
      author: z.enum(ASSIGNEES).optional().describe(`Default '${AGENT}' (this server's agent)`)
    }
  },
  (a) => run(() => repo.addNote(a.id, a.text, a.author ?? AGENT))
)

server.registerTool(
  'list_notes',
  {
    title: 'List notes',
    description: "An item's notes, oldest first, each with timestamp, author and text.",
    inputSchema: { id },
    annotations: { readOnlyHint: true }
  },
  (a) => run(() => repo.listNotes(a.id))
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
console.error(`[forge-desk-mcp] ready — agent: ${AGENT}, database: ${dbPath}`)

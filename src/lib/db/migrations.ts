/**
 * Database Migrations System
 * 
 * Handles schema changes in a production-safe way:
 * 1. Tracks which migrations have been applied
 * 2. Runs new migrations automatically on startup
 * 3. Never runs the same migration twice
 */

import Database from 'better-sqlite3';
import fs from 'fs';

interface Migration {
  id: string;
  name: string;
  up: (db: Database.Database) => void;
}

// All migrations in order - NEVER remove or reorder existing migrations
const migrations: Migration[] = [
  {
    id: '001',
    name: 'initial_schema',
    up: (db) => {
      // Core tables - these are created in schema.ts on fresh databases
      // This migration exists to mark the baseline for existing databases
      console.log('[Migration 001] Baseline schema marker');
    }
  },
  {
    id: '002',
    name: 'add_workspaces',
    up: (db) => {
      console.log('[Migration 002] Adding workspaces table and columns...');
      
      // Create workspaces table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          description TEXT,
          icon TEXT DEFAULT '📁',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);
      
      // Insert default workspace if not exists
      db.exec(`
        INSERT OR IGNORE INTO workspaces (id, name, slug, description, icon) 
        VALUES ('default', 'Default Workspace', 'default', 'Default workspace', '🏠');
      `);
      
      // Add workspace_id to tasks if not exists
      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
      if (!tasksInfo.some(col => col.name === 'workspace_id')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id)`);
        console.log('[Migration 002] Added workspace_id to tasks');
      }
      
      // Add workspace_id to agents if not exists
      const agentsInfo = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
      if (!agentsInfo.some(col => col.name === 'workspace_id')) {
        db.exec(`ALTER TABLE agents ADD COLUMN workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id)`);
        console.log('[Migration 002] Added workspace_id to agents');
      }
    }
  },
  {
    id: '003',
    name: 'add_planning_tables',
    up: (db) => {
      console.log('[Migration 003] Adding planning tables...');
      
      // Create planning_questions table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS planning_questions (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          question TEXT NOT NULL,
          question_type TEXT DEFAULT 'multiple_choice' CHECK (question_type IN ('multiple_choice', 'text', 'yes_no')),
          options TEXT,
          answer TEXT,
          answered_at TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
      
      // Create planning_specs table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS planning_specs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
          spec_markdown TEXT NOT NULL,
          locked_at TEXT NOT NULL,
          locked_by TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
      
      // Create index
      db.exec(`CREATE INDEX IF NOT EXISTS idx_planning_questions_task ON planning_questions(task_id, sort_order)`);
      
      // Update tasks status check constraint to include 'planning'
      // SQLite doesn't support ALTER CONSTRAINT, so we check if it's needed
      const taskSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as { sql: string } | undefined;
      if (taskSchema && !taskSchema.sql.includes("'planning'")) {
        console.log('[Migration 003] Note: tasks table needs planning status - will be handled by schema recreation on fresh dbs');
      }
    }
  },
  {
    id: '004',
    name: 'add_planning_session_columns',
    up: (db) => {
      console.log('[Migration 004] Adding planning session columns to tasks...');

      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];

      // Add planning_session_key column
      if (!tasksInfo.some(col => col.name === 'planning_session_key')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_session_key TEXT`);
        console.log('[Migration 004] Added planning_session_key');
      }

      // Add planning_messages column (stores JSON array of messages)
      if (!tasksInfo.some(col => col.name === 'planning_messages')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_messages TEXT`);
        console.log('[Migration 004] Added planning_messages');
      }

      // Add planning_complete column
      if (!tasksInfo.some(col => col.name === 'planning_complete')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_complete INTEGER DEFAULT 0`);
        console.log('[Migration 004] Added planning_complete');
      }

      // Add planning_spec column (stores final spec JSON)
      if (!tasksInfo.some(col => col.name === 'planning_spec')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_spec TEXT`);
        console.log('[Migration 004] Added planning_spec');
      }

      // Add planning_agents column (stores generated agents JSON)
      if (!tasksInfo.some(col => col.name === 'planning_agents')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_agents TEXT`);
        console.log('[Migration 004] Added planning_agents');
      }
    }
  },
  {
    id: '005',
    name: 'add_agent_model_field',
    up: (db) => {
      console.log('[Migration 005] Adding model field to agents...');

      const agentsInfo = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];

      // Add model column
      if (!agentsInfo.some(col => col.name === 'model')) {
        db.exec(`ALTER TABLE agents ADD COLUMN model TEXT`);
        console.log('[Migration 005] Added model to agents');
      }
    }
  },
  {
    id: '006',
    name: 'add_planning_dispatch_error_column',
    up: (db) => {
      console.log('[Migration 006] Adding planning_dispatch_error column to tasks...');

      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];

      // Add planning_dispatch_error column
      if (!tasksInfo.some(col => col.name === 'planning_dispatch_error')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_dispatch_error TEXT`);
        console.log('[Migration 006] Added planning_dispatch_error to tasks');
      }
    }
  },
  {
    id: '007',
    name: 'add_agent_source_and_gateway_id',
    up: (db) => {
      console.log('[Migration 007] Adding source and gateway_agent_id to agents...');

      const agentsInfo = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];

      // Add source column: 'local' for MC-created, 'gateway' for imported from OpenClaw Gateway
      if (!agentsInfo.some(col => col.name === 'source')) {
        db.exec(`ALTER TABLE agents ADD COLUMN source TEXT DEFAULT 'local'`);
        console.log('[Migration 007] Added source to agents');
      }

      // Add gateway_agent_id column: stores the original agent ID/name from the Gateway
      if (!agentsInfo.some(col => col.name === 'gateway_agent_id')) {
        db.exec(`ALTER TABLE agents ADD COLUMN gateway_agent_id TEXT`);
        console.log('[Migration 007] Added gateway_agent_id to agents');
      }
    }
  },
  {
    id: '008',
    name: 'add_swarm_topology_tables',
    up: (db) => {
      console.log('[Migration 008] Adding swarm topology tables (non-destructive)...');

      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_roles (
          role_id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          domain TEXT NOT NULL,
          profile_type TEXT NOT NULL DEFAULT 'virtual',
          default_agent_id TEXT,
          prompt_template_ref TEXT,
          output_schema_version TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);

      db.exec(`
        INSERT OR IGNORE INTO agent_roles (role_id, display_name, domain, profile_type, enabled)
        VALUES
          ('MC-MAIN', 'MC-MAIN Orchestrator', 'Shared', 'virtual', 1),
          ('dc_tech_financial_modeler', 'DC-FIN Modeler', 'DC', 'virtual', 1);
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS swarm_tasks (
          task_id TEXT PRIMARY KEY,
          parent_task_id TEXT,
          ws TEXT NOT NULL,
          title TEXT NOT NULL,
          objective TEXT,
          owner_role_id TEXT,
          priority TEXT NOT NULL DEFAULT 'P2',
          risk_tier TEXT NOT NULL DEFAULT 'medium',
          status TEXT NOT NULL,
          is_proactive INTEGER NOT NULL DEFAULT 0,
          origin_type TEXT NOT NULL DEFAULT 'topdown',
          sla_hours INTEGER,
          source_event TEXT,
          created_by TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY(parent_task_id) REFERENCES swarm_tasks(task_id),
          FOREIGN KEY(owner_role_id) REFERENCES agent_roles(role_id)
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_swarm_tasks_status ON swarm_tasks(status)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_swarm_tasks_priority ON swarm_tasks(priority)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_swarm_tasks_proactive ON swarm_tasks(is_proactive)`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS swarm_runs (
          run_id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          role_id TEXT NOT NULL,
          session_key TEXT,
          provider_run_id TEXT,
          run_status TEXT NOT NULL,
          started_at TEXT,
          ended_at TEXT,
          duration_ms INTEGER,
          output_path TEXT,
          output_summary TEXT,
          error_message TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY(task_id) REFERENCES swarm_tasks(task_id),
          FOREIGN KEY(role_id) REFERENCES agent_roles(role_id)
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_swarm_runs_task ON swarm_runs(task_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_swarm_runs_status ON swarm_runs(run_status)`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS swarm_handoffs (
          handoff_id TEXT PRIMARY KEY,
          from_role_id TEXT NOT NULL,
          to_role_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          handoff_type TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY(task_id) REFERENCES swarm_tasks(task_id)
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_swarm_handoffs_task ON swarm_handoffs(task_id)`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS swarm_approvals (
          approval_id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          gate_reason TEXT,
          approval_status TEXT NOT NULL DEFAULT 'pending',
          requested_at TEXT DEFAULT (datetime('now')),
          decided_at TEXT,
          decided_by TEXT,
          decision_note TEXT,
          FOREIGN KEY(task_id) REFERENCES swarm_tasks(task_id)
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_swarm_approvals_status ON swarm_approvals(approval_status)`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS swarm_moc_links (
          link_id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          moc_path TEXT NOT NULL,
          ref_type TEXT NOT NULL DEFAULT 'context',
          last_synced_at TEXT,
          FOREIGN KEY(task_id) REFERENCES swarm_tasks(task_id)
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_swarm_moc_task ON swarm_moc_links(task_id)`);
    }
  },
  {
    id: '009',
    name: 'add_agent_roles_version_for_optimistic_locking',
    up: (db) => {
      console.log('[Migration 009] Adding version column to agent_roles...');

      const roleInfo = db.prepare("PRAGMA table_info(agent_roles)").all() as { name: string }[];
      if (!roleInfo.some((col) => col.name === 'version')) {
        db.exec(`ALTER TABLE agent_roles ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
        console.log('[Migration 009] Added version column');
      }

      db.exec(`UPDATE agent_roles SET version = 1 WHERE version IS NULL OR version < 1`);
    }
  },
  {
    id: '010',
    name: 'normalize_agent_role_domains_to_enum',
    up: (db) => {
      console.log('[Migration 010] Normalizing agent role domains to underscore enum...');
      db.exec(`UPDATE agent_roles SET domain = 'DATA_CENTER' WHERE domain = 'DATA-CENTER'`);
      db.exec(`UPDATE agent_roles SET domain = 'WEB_APP' WHERE domain = 'WEB-APP'`);
      db.exec(`UPDATE agent_roles SET domain = 'VENTURE' WHERE domain = 'Venture'`);
    }
  },
  {
    id: '011',
    name: 'extend_swarm_tasks_for_parent_child_pipeline_context',
    up: (db) => {
      console.log('[Migration 011] Extending swarm_tasks with parent/ordering/context columns...');

      const swarmTaskInfo = db.prepare("PRAGMA table_info(swarm_tasks)").all() as { name: string }[];

      if (!swarmTaskInfo.some((col) => col.name === 'parent_task_id')) {
        db.exec(`ALTER TABLE swarm_tasks ADD COLUMN parent_task_id TEXT REFERENCES swarm_tasks(task_id)`);
        console.log('[Migration 011] Added parent_task_id to swarm_tasks');
      }

      if (!swarmTaskInfo.some((col) => col.name === 'execution_order')) {
        db.exec(`ALTER TABLE swarm_tasks ADD COLUMN execution_order INTEGER NOT NULL DEFAULT 0`);
        console.log('[Migration 011] Added execution_order to swarm_tasks');
      }

      if (!swarmTaskInfo.some((col) => col.name === 'context_payload')) {
        db.exec(`ALTER TABLE swarm_tasks ADD COLUMN context_payload TEXT`);
        console.log('[Migration 011] Added context_payload to swarm_tasks');
      }
    }
  },
  {
    id: '012',
    name: 'inject_monica_orchestration_addendum',
    up: (db) => {
      console.log('[Migration 012] Injecting ORCHESTRATION ADDENDUM into MC-MAIN prompt...');

      const addendum = [
        'ORCHESTRATION ADDENDUM',
        '1. You are the Chief of Staff & Dispatcher. Your default behavior is to orchestrate, NOT to execute everything yourself.',
        '2. When receiving a complex task, ALWAYS use the create_subtasks tool to fan-out the work to 2-3 specialized agents.',
        '3. Assign execution_order: 1 for parallel workers (e.g., DC Colocation Strategist, Chief Macro Strategist).',
        '4. You MUST NOT write the final report until the subtasks are completed.'
      ].join('\\n');

      const row = db.prepare("SELECT prompt_template_ref FROM agent_roles WHERE role_id = 'MC-MAIN'").get() as { prompt_template_ref: string | null } | undefined;
      const basePrompt = (row?.prompt_template_ref || '').trim();

      if (basePrompt.includes('ORCHESTRATION ADDENDUM')) {
        console.log('[Migration 012] MC-MAIN prompt already contains addendum - skip');
        return;
      }

      const merged = [basePrompt, '', addendum].filter(Boolean).join('\\n\\n');

      db.prepare(`
        UPDATE agent_roles
        SET prompt_template_ref = ?,
            updated_at = datetime('now'),
            version = COALESCE(version, 1) + 1
        WHERE role_id = 'MC-MAIN'
      `).run(merged);

      console.log('[Migration 012] MC-MAIN prompt updated');
    }
  },
  {
    id: '013',
    name: 'inject_monica_synthesis_format_rules',
    up: (db) => {
      console.log('[Migration 013] Injecting synthesis format rules into MC-MAIN prompt...');

      const addendum = [
        'SYNTHESIS OUTPUT ADDENDUM',
        'When producing final synthesis report, you MUST follow this exact top section format:',
        '1) First line: [DOMAIN: 거시경제|데이터센터|투자전략] (choose exactly one)',
        '2) Then heading: [EXECUTIVE SUMMARY]',
        '3) Then exactly 3 lines summarizing the core insight (exactly three lines, no more/no less).'
      ].join('\\n');

      const row = db.prepare("SELECT prompt_template_ref FROM agent_roles WHERE role_id = 'MC-MAIN'").get() as { prompt_template_ref: string | null } | undefined;
      const basePrompt = (row?.prompt_template_ref || '').trim();

      if (basePrompt.includes('SYNTHESIS OUTPUT ADDENDUM')) {
        console.log('[Migration 013] MC-MAIN prompt already contains synthesis addendum - skip');
        return;
      }

      const merged = [basePrompt, '', addendum].filter(Boolean).join('\\n\\n');

      db.prepare(`
        UPDATE agent_roles
        SET prompt_template_ref = ?,
            updated_at = datetime('now'),
            version = COALESCE(version, 1) + 1
        WHERE role_id = 'MC-MAIN'
      `).run(merged);

      console.log('[Migration 013] MC-MAIN synthesis prompt updated');
    }
  },
  {
    id: '014',
    name: 'inject_monica_protocol_v2_control_plane_first',
    up: (db) => {
      console.log('[Migration 014] Injecting TEAM-COMMS HYBRID PROTOCOL v2 into MC-MAIN prompt...');

      const addendum = `[TEAM-COMMS HYBRID PROTOCOL v2 — CONTROL-PLANE FIRST]
You are Monica, Mission Control (Control Plane). Goal: maximize output quality and speed while preserving deterministic auditability.
NON-NEGOTIABLE INVARIANTS
1) SSoT is the task store (swarm_tasks + derived tables). The blackboard is READ-MODEL only.
2) Do not replace Task Graph orchestration with free-form messaging.
3) Do not suppress sub-agent announce steps (they are required for fan-in).
4) By default, DO NOT use sessions_send / agent-to-agent messaging in production paths. - If (and only if) A2A is explicitly enabled and verified safe, treat it as "Interrupt-only" with max 1 exchange.
A. MODE SELECTION (choose one per parent task)
1) DAG Mode (default): parent/child tasks + state machine + synthesis ignition
2) Team Mode (high uncertainty): still DAG, but allow faster replanning via Insight Events + Mailbox (NOT chat)
B. FAN-OUT RULE (bounded)
- If task touches ≥2 domains AND uncertainty is medium/high: create at least 2 child tasks in parallel.
- Otherwise, keep it single-threaded to reduce coordination cost.
C. INSIGHT EVENT RULE (mandatory)
Every child task MUST output an INSIGHT PACKET (schema-defined). Mission Control MUST record it to SSoT (swarm_insights or context_payload event).
Severity handling:
- S0/S1: merge into next synthesis
- S2: create Interrupt Task + mark affected tasks needs_update/blocked
- S3: STOP-THE-LINE. Freeze parent until explicit approval.
D. REPLANNING (deterministic)
If new evidence changes assumptions:
1) identify affected tasks
2) transition state (blocked/needs_update)
3) create/rewire tasks with explicit dependencies
4) update execution_order
Termination: enforce max_replans / max_interrupts / budget caps.
E. QUALITY GATES (required)
- Before final synthesis, run a Verifier/Red-Team task unless the parent is trivial.
- No evidence → mark as assumption → do not present as fact.
F. EVOLUTION LOOP (governed change)
- After parent DONE, create a Retrospective task.
- Store improvements as proposed_change with version + rollback plan.
- No change is applied without explicit approval and history.`;

      const row = db.prepare("SELECT prompt_template_ref FROM agent_roles WHERE role_id = 'MC-MAIN'").get() as { prompt_template_ref: string | null } | undefined;
      const basePrompt = (row?.prompt_template_ref || '').trim();

      if (basePrompt.includes('[TEAM-COMMS HYBRID PROTOCOL v2 — CONTROL-PLANE FIRST]')) {
        console.log('[Migration 014] MC-MAIN prompt already contains protocol v2 - skip');
        return;
      }

      const merged = basePrompt
        ? `${basePrompt}\n\n${addendum}`
        : addendum;

      db.prepare(`
        UPDATE agent_roles
        SET prompt_template_ref = ?,
            updated_at = datetime('now'),
            version = COALESCE(version, 1) + 1
        WHERE role_id = 'MC-MAIN'
      `).run(merged);

      console.log('[Migration 014] MC-MAIN prompt updated');
    }
  },

  {
    id: '015',
    name: 'inject_worker_contract_v2',
    up: (db) => {
      console.log('[Migration 015] Injecting Worker Contract V2 into non-MC-MAIN agent prompts...');

      const addendum = `[WORKER COLLAB CONTRACT v2 — EVIDENCE-FIRST]
Single Responsibility: produce one deliverable for your assigned task.

RULES
1) Do not coordinate via free-form chat. Do not use sessions_send unless explicitly instructed.
2) Always write outputs as artifacts (file paths) OR structured fields; never "only text" if reproducibility matters.
3) Separate Facts vs Assumptions.
Facts require evidence_refs.

STATUS (must emit one) - started | partial | done | blocked (with reason)
OUTPUT (mandatory): INSIGHT PACKET v2
- Claim: one sentence
- Evidence_Refs: list of {type: url|file|db_query|calc, ref: "...", snippet: "...", timestamp: "..."}
- Impact: what changes for the parent plan (assumptions, numbers, risks)
- Suggested_Next_Tasks: who should do what next + why
- Affected_Tasks: [task_ids or task_titles]
- Severity: S0 | S1 | S2 | S3
- Deliverables: [file paths or structured outputs]`;

      const roles = db
        .prepare("SELECT role_id, prompt_template_ref FROM agent_roles WHERE role_id != 'MC-MAIN'")
        .all() as Array<{ role_id: string; prompt_template_ref: string | null }>;

      const markerText = '[WORKER COLLAB CONTRACT v2 — EVIDENCE-FIRST]';

      for (const role of roles) {
        const basePrompt = (role.prompt_template_ref || '').trim();

        if (basePrompt.includes(markerText)) {
          console.log(`[Migration 015] Skipped ${role.role_id} (already contains Worker Contract V2)`);
          continue;
        }

        const merged = basePrompt ? `${basePrompt}

${addendum}` : addendum;

        db.prepare(`
          UPDATE agent_roles
          SET prompt_template_ref = ?,
              updated_at = datetime('now'),
              version = COALESCE(version, 1) + 1
          WHERE role_id = ?
        `).run(merged, role.role_id);

        console.log(`[Migration 015] Injected Worker Contract V2 into ${role.role_id}`);
      }
    }
  },
  {
    id: '016',
    name: 'inject_verifier_quality_gate',
    up: (db) => {
      console.log('[Migration 016] Injecting Verifier Hard Audit prompts into quality roles...');

      const addendum = `[VERIFIER QUALITY GATE v1 — HARD AUDIT]
Role: Red-Team verifier. Your job is to find errors, missing evidence, and risky assumptions.
You must produce a REVIEW PACKET:
- Verdict: APPROVE | NEEDS_REVISION | BLOCK
- Top 5 Issues (ordered by severity)
- Evidence Check: which claims lack evidence_refs
- Logic Check: where reasoning is non-sequitur or inconsistent
- Numerical Check: recompute/validate any key numbers (show calc refs)
- Missing Counterpoints: at least 2 alternative interpretations
- Required Fixes: exact edits needed
- "3 ways this could be wrong" (mandatory)`;

      const candidates = db
        .prepare("SELECT role_id, prompt_template_ref FROM agent_roles WHERE role_id = 'shared_editor_quality_gate' OR role_id = 'shared_deep_researcher_dwight'")
        .all() as Array<{ role_id: string; prompt_template_ref: string | null }>;

      const marker = '[VERIFIER QUALITY GATE v1 — HARD AUDIT]';
      const created: string[] = [];
      const targetIds = new Set(candidates.map((r) => r.role_id));

      for (const role of candidates) {
        const current = (role.prompt_template_ref || '').trim();

        if (current.includes(marker)) {
          console.log(`[Migration 016] Skipped ${role.role_id} (already has verifier hard audit)`);
          continue;
        }

        const merged = `${addendum}

${current}`;
        db.prepare(`
          UPDATE agent_roles
          SET prompt_template_ref = ?,
              updated_at = datetime('now'),
              version = COALESCE(version, 1) + 1
          WHERE role_id = ?
        `).run(merged, role.role_id);

        console.log(`[Migration 016] Injected verifier hard audit into ${role.role_id}`);
        created.push(role.role_id);
      }

      if (!targetIds.has('verifier_red_team')) {
        console.log('[Migration 016] verifier_red_team missing; creating fallback verifier role with hard audit prompt');
        db.exec(`
          CREATE TABLE IF NOT EXISTS agent_roles (
            role_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            domain TEXT NOT NULL,
            profile_type TEXT NOT NULL DEFAULT 'virtual',
            default_agent_id TEXT,
            prompt_template_ref TEXT,
            output_schema_version TEXT,
            version INTEGER NOT NULL DEFAULT 1,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          );
        `);

        db.prepare(`
          INSERT INTO agent_roles (
            role_id,
            display_name,
            domain,
            profile_type,
            prompt_template_ref,
            output_schema_version,
            version,
            enabled,
            created_at,
            updated_at
          )
          VALUES (?, ?, 'SHARED', 'virtual', ?, NULL, 1, 1, datetime('now'), datetime('now'))
        `).run('verifier_red_team', 'Verifier Red-Team', addendum);

        console.log('[Migration 016] Created verifier_red_team role');
        created.push('verifier_red_team');
      }

      console.log('[Migration 016] Verifier quality gate migration completed', created);
    }
  },
  {
    id: '017',
    name: 'inject_worker_contract_v2_evidence_first',
    up: (db) => {
      console.log('[Migration 017] Replacing worker prompts with Worker Collab Contract v2 (evidence-first) for non-MC-MAIN roles...');

      const addendum = `[WORKER COLLAB CONTRACT v2 — EVIDENCE-FIRST]
SINGLE RESPONSIBILITY
Your sole objective is to produce one deliverable for your assigned task.

RULES OF ENGAGEMENT
1) STRICT BAN ON FREE-FORM CHAT: Do not coordinate via unstructured messaging. Do not use sessions_send unless explicitly instructed. Escalate issues ONLY via Insight Severity.
2) ARTIFACT-DRIVEN OUTPUT: Always write outputs as artifacts (file paths) OR structured fields. Never output "only text" if reproducibility matters.
3) FACTS VS ASSUMPTIONS: You must clearly separate known facts from assumptions. Any factual claim requires explicit evidence_refs. No evidence = Assumption.

MANDATORY STATUS UPDATE
You must emit exactly one of the following states during your execution:
- started | partial | done | blocked (include reason)

MANDATORY OUTPUT: INSIGHT PACKET v2
Before concluding your task, you MUST output an INSIGHT PACKET v2 containing:
- Claim: A concise, one-sentence summary.
- Evidence_Refs: List of {type: url|file|db_query|calc, ref: "...", snippet: "...", timestamp: "..."}.
- Impact: How this changes the parent plan (assumptions, numbers, risks).
- Suggested_Next_Tasks: Who should do what next + why.
- Affected_Tasks: [task_ids or task_titles].
- Severity: S0 (Info) | S1 (Low) | S2 (High) | S3 (Critical).
- Deliverables: [file paths or structured outputs].
- Open_Questions: (Required if status is 'blocked' or uncertain).`;

      const rows = db
        .prepare("SELECT role_id, prompt_template_ref FROM agent_roles WHERE role_id != 'MC-MAIN'")
        .all() as Array<{ role_id: string; prompt_template_ref: string | null }>;

      for (const row of rows) {
        const current = row.prompt_template_ref || '';
        const marker = '[WORKER COLLAB CONTRACT v2 — EVIDENCE-FIRST]';
        const regex = new RegExp(`${marker}[\s\S]*$`);
        const cleaned = current.replace(regex, '').trim();
        const merged = cleaned ? `${cleaned}

${addendum}` : addendum;

        db.prepare(`
          UPDATE agent_roles
          SET prompt_template_ref = ?,
              updated_at = datetime('now'),
              version = COALESCE(version, 1) + 1
          WHERE role_id = ?
        `).run(merged, row.role_id);

        console.log(`[Migration 017] Rewritten worker contract for ${row.role_id}`);
      }
    }
  },

  {
    id: '018',
    name: 'inject_verifier_quality_gate_prompt_top',
    up: (db) => {
      console.log('[Migration 018] Injecting Verifier Quality Gate prompt from quality gates file for quality agents...');

      const doc = fs.readFileSync('/Users/josh/.openclaw/workspace/docs/gro/30_QUALITY_GATES.md', 'utf8');
      const markerText = '[VERIFIER QUALITY GATE v1 — HARD AUDIT]';
      const start = doc.indexOf(markerText);
      const block = doc.slice(start);

      const targetRoles = ['shared_deep_researcher_dwight', 'shared_editor_quality_gate'];

      for (const roleId of targetRoles) {
        const role = db.prepare("SELECT prompt_template_ref FROM agent_roles WHERE role_id = ?").get(roleId) as { prompt_template_ref: string | null } | undefined;
        if (!role) {
          console.log(`[Migration 018] target missing: ${roleId}`);
          continue;
        }

        const current = role.prompt_template_ref || '';
        const markerRegex = new RegExp(`${markerText}[\s\S]*$`);
        const stripped = current.replace(markerRegex, '').trim();
        const finalPrompt = stripped ? `${stripped}

${block}` : block;

        db.prepare(`
          UPDATE agent_roles
          SET prompt_template_ref = ?,
              updated_at = datetime('now'),
              version = COALESCE(version, 1) + 1
          WHERE role_id = ?
        `).run(finalPrompt, roleId);

        console.log(`[Migration 018] injected verifier prompt into ${roleId}`);
      }
    }
  }


];

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);
  
  // Get already applied migrations
  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map(m => m.id)
  );
  
  // Run pending migrations in order
  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }
    
    console.log(`[DB] Running migration ${migration.id}: ${migration.name}`);
    
    try {
      // Run migration in a transaction
      db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(migration.id, migration.name);
      })();
      
      console.log(`[DB] Migration ${migration.id} completed`);
    } catch (error) {
      console.error(`[DB] Migration ${migration.id} failed:`, error);
      throw error;
    }
  }
}

/**
 * Get migration status
 */
export function getMigrationStatus(db: Database.Database): { applied: string[]; pending: string[] } {
  const applied = (db.prepare('SELECT id FROM _migrations ORDER BY id').all() as { id: string }[]).map(m => m.id);
  const pending = migrations.filter(m => !applied.includes(m.id)).map(m => m.id);
  return { applied, pending };
}

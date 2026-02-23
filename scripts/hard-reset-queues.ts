import path from 'path';
import Database from 'better-sqlite3';

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'mission-control.db');
const db = new Database(dbPath);

db.pragma('foreign_keys = ON');

const before = {
  tasks: db.prepare("SELECT COUNT(*) c FROM swarm_tasks").get() as { c: number },
  runs: db.prepare("SELECT COUNT(*) c FROM swarm_runs").get() as { c: number },
  handoffs: db.prepare("SELECT COUNT(*) c FROM swarm_handoffs").get() as { c: number },
  approvals: db.prepare("SELECT COUNT(*) c FROM swarm_approvals").get() as { c: number },
  events: db.prepare("SELECT COUNT(*) c FROM events").get() as { c: number },
};

const tx = db.transaction(() => {
  db.prepare('DELETE FROM swarm_handoffs').run();
  db.prepare('DELETE FROM swarm_approvals').run();
  db.prepare('DELETE FROM swarm_runs').run();
  db.prepare('DELETE FROM swarm_tasks').run();
  db.prepare('DELETE FROM events').run();
});

tx();

const after = {
  tasks: db.prepare("SELECT COUNT(*) c FROM swarm_tasks").get() as { c: number },
  runs: db.prepare("SELECT COUNT(*) c FROM swarm_runs").get() as { c: number },
  handoffs: db.prepare("SELECT COUNT(*) c FROM swarm_handoffs").get() as { c: number },
  approvals: db.prepare("SELECT COUNT(*) c FROM swarm_approvals").get() as { c: number },
  events: db.prepare("SELECT COUNT(*) c FROM events").get() as { c: number },
};

console.log('hard-reset-queues');
console.log('dbPath=', dbPath);
console.log('before=', before);
console.log('after=', after);

db.close();

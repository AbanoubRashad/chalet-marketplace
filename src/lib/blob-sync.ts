// Demo hosting on serverless (Vercel): each instance has its own /tmp, so the SQLite file is mirrored to a
// private Vercel Blob. After every committed write we upload it; before using the DB (at most every 1.5 s)
// we ask the Blob for a newer version (ETag) and download it if another instance wrote meanwhile.
// The DB layer is synchronous, so Blob calls run in a worker thread that we wait on with Atomics.wait.
// Last writer wins: fine for a low-traffic demo, not for production (use a real database there).
import path from "node:path";
import { MessageChannel, receiveMessageOnPort, Worker } from "node:worker_threads";

const g = globalThis as unknown as { __blobSync?: { worker: Worker; etag: string | null; lastCheck: number } };

export function blobSyncEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN && process.env.DATABASE_PATH);
}

const pathname = () => process.env.BLOB_DB_PATHNAME || `db/${path.basename(process.env.DATABASE_PATH!)}`;

function state() {
  if (!g.__blobSync) {
    const worker = new Worker(path.join(process.cwd(), "vendor", "blob-worker.cjs"));
    worker.unref();
    g.__blobSync = { worker, etag: null, lastCheck: 0 };
  }
  return g.__blobSync;
}

function call(op: "pull" | "push", args: Record<string, unknown>): { status?: number; etag?: string | null; error?: string } {
  const s = state();
  const sab = new SharedArrayBuffer(4);
  const flag = new Int32Array(sab);
  const { port1, port2 } = new MessageChannel();
  s.worker.postMessage({ op, args, sab, port: port2 }, [port2]);
  Atomics.wait(flag, 0, 0, 20_000);
  const msg = receiveMessageOnPort(port1)?.message as { status?: number; etag?: string | null; error?: string } | undefined;
  port1.close();
  return msg ?? { error: "timeout" };
}

/** Downloads the shared DB if it changed since our copy. Returns true when the local file was replaced. */
export function pullIfChanged(file: string, force = false): boolean {
  const s = state();
  if (!force && Date.now() - s.lastCheck < 1500) return false;
  s.lastCheck = Date.now();
  const r = call("pull", { pathname: pathname(), file, etag: force ? null : s.etag });
  if (r.error) {
    console.error("[blob-sync] pull failed:", r.error);
    return false;
  }
  if (r.status === 200) {
    s.etag = r.etag ?? null;
    return true;
  }
  if (r.status === 304) s.etag = r.etag ?? s.etag;
  return false;
}

export function push(file: string) {
  const r = call("push", { pathname: pathname(), file });
  if (r.error) console.error("[blob-sync] push failed:", r.error);
  else state().etag = r.etag ?? null;
  state().lastCheck = Date.now();
}

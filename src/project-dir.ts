import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Claude Code's project-folder-name encoding: path separators and colons become '-'. */
export function encodeProjectPath(absPath: string): string {
  return absPath.replace(/[:\\/]/g, "-");
}

export function claudeProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

function norm(p: string): string {
  return path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();
}

/**
 * Robust fallback: the log records themselves carry a `cwd` field. Scan each
 * project dir's newest session file and match on that - no guessing about
 * Claude Code's name-encoding rules (dots, spaces, unicode, …).
 */
function findByCwdField(sourceDir: string): string | undefined {
  const root = claudeProjectsRoot();
  if (!fs.existsSync(root)) return undefined;
  const want = norm(sourceDir);
  for (const proj of fs.readdirSync(root)) {
    const dir = path.join(root, proj);
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const head = fs.readFileSync(path.join(dir, f), "utf8").split("\n", 20);
        for (const line of head) {
          if (!line.trim()) continue;
          try {
            const rec = JSON.parse(line);
            if (typeof rec?.cwd === "string") {
              if (norm(rec.cwd) === want) return dir;
              break; // cwd found but different - next file
            }
          } catch {
            /* skip corrupt line */
          }
        }
      } catch {
        /* unreadable file */
      }
      break; // one file per project dir is enough to identify it
    }
  }
  return undefined;
}

/** The Claude Code log directory corresponding to a given project source dir, if any. */
export function resolveProjectLogDir(sourceDir: string): string | undefined {
  const encoded = path.join(claudeProjectsRoot(), encodeProjectPath(path.resolve(sourceDir)));
  if (fs.existsSync(encoded)) return encoded;
  return findByCwdField(sourceDir);
}

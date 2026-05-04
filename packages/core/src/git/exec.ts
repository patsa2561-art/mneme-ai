import { spawn } from "node:child_process";

export interface ExecOptions {
  cwd: string;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function execGit(args: string[], opts: ExecOptions): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      windowsHide: true,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutSize = 0;
    const maxBuffer = opts.maxBuffer ?? 256 * 1024 * 1024;

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutSize += chunk.length;
      if (stdoutSize > maxBuffer) {
        child.kill();
        reject(new Error(`git ${args[0]} exceeded max buffer (${maxBuffer} bytes)`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code: code ?? 0,
      });
    });
  });
}

export async function execGitOk(args: string[], opts: ExecOptions): Promise<string> {
  const r = await execGit(args, opts);
  if (r.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (exit ${r.code}): ${r.stderr.trim()}`);
  }
  return r.stdout;
}

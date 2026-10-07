import path from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { IPty } from "node-pty";
import * as pty from "node-pty";
import type {
  ShellKind,
  TerminalDefinition,
  TerminalSnapshot,
} from "../shared/types";

interface Session {
  definition: TerminalDefinition;
  process: IPty;
  buffer: string;
  alive: boolean;
}

export class TerminalManager {
  private sessions = new Map<string, Session>();
  constructor(
    private onData: (id: string, data: string) => void,
    private onExit: (id: string) => void,
  ) {}

  static shellPath(shell: ShellKind): string {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const executable =
      shell === "cmd" ? "cmd.exe" : "WindowsPowerShell\\v1.0\\powershell.exe";
    return path.join(systemRoot, "System32", executable);
  }

  create(input: {
    projectId: string | null;
    cwd: string;
    shell: ShellKind;
    title?: string;
  }): TerminalSnapshot {
    const definition: TerminalDefinition = {
      id: randomUUID(),
      projectId: input.projectId,
      cwd: input.cwd,
      shell: input.shell,
      title:
        input.title || (input.shell === "cmd" ? "命令提示符" : "PowerShell"),
    };
    return this.start(definition);
  }

  start(definition: TerminalDefinition): TerminalSnapshot {
    const shellPath = TerminalManager.shellPath(definition.shell);
    if (!existsSync(shellPath)) throw new Error(`未找到 ${definition.shell}`);
    const cwd = existsSync(definition.cwd)
      ? definition.cwd
      : process.env.USERPROFILE || process.cwd();
    const processInstance = pty.spawn(shellPath, [], {
      name: "xterm-256color",
      cols: 100,
      rows: 28,
      cwd,
      env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
      useConpty: true,
      useConptyDll: true,
    });
    const session: Session = {
      definition: { ...definition, cwd },
      process: processInstance,
      buffer: "",
      alive: true,
    };
    this.sessions.set(definition.id, session);
    processInstance.onData((data) => {
      session.buffer = (session.buffer + data).slice(-50000);
      this.onData(definition.id, data);
    });
    processInstance.onExit(() => {
      session.alive = false;
      this.onExit(definition.id);
    });
    return this.snapshot(definition.id)!;
  }

  snapshot(id: string): TerminalSnapshot | null {
    const session = this.sessions.get(id);
    return session
      ? { ...session.definition, buffer: session.buffer, alive: session.alive }
      : null;
  }

  list(): TerminalSnapshot[] {
    return Array.from(this.sessions.keys()).map((id) => this.snapshot(id)!);
  }

  updateMetadata(
    id: string,
    input: { title?: string; projectId?: string | null },
  ): TerminalSnapshot {
    const session = this.sessions.get(id);
    if (!session) throw new Error("终端不存在或未能恢复");
    session.definition = { ...session.definition, ...input };
    return this.snapshot(id)!;
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session?.alive) return;
    session.process.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session?.alive)
      session.process.resize(
        Math.max(2, Math.min(500, Math.floor(cols))),
        Math.max(2, Math.min(200, Math.floor(rows))),
      );
  }

  close(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    if (session.alive) session.process.kill();
  }

  closeAll(): void {
    for (const id of this.sessions.keys()) this.close(id);
  }
}

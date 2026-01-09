import type { CommandResult, Sandbox } from "../types.js";

/**
 * Minimal interface for the just-bash methods we actually use.
 * This allows proper typing without requiring the full class.
 */
export interface JustBashLike {
  exec: (command: string) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
  fs: {
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
  };
}

/**
 * Options for creating a just-bash sandbox.
 */
export interface JustBashSandboxOptions {
  /** Initial files to populate the virtual filesystem */
  files?: Record<string, string>;
  /** Working directory */
  cwd?: string;
}

/**
 * Creates a Sandbox implementation using just-bash (virtual bash environment).
 * Dynamically imports just-bash to keep it as an optional peer dependency.
 */
export async function createJustBashSandbox(
  options: JustBashSandboxOptions = {},
): Promise<Sandbox> {
  // Dynamic import to handle optional peer dependency
  let Bash: typeof import("just-bash").Bash;
  try {
    const module = await import("just-bash");
    Bash = module.Bash;
  } catch {
    throw new Error(
      'just-bash is not installed. Either install it with "npm install just-bash" or provide your own sandbox via the sandbox option.',
    );
  }

  const bashEnv = new Bash({
    files: options.files,
    cwd: options.cwd,
  });

  return {
    async executeCommand(command: string): Promise<CommandResult> {
      const result = await bashEnv.exec(command);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    },

    async readFile(filePath: string): Promise<string> {
      return bashEnv.fs.readFile(filePath);
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      await bashEnv.fs.writeFile(filePath, content);
    },
  };
}

/**
 * Check if an object is a just-bash Bash instance using duck-typing.
 */
export function isJustBash(obj: unknown): obj is JustBashLike {
  if (!obj || typeof obj !== "object") return false;
  const candidate = obj as Record<string, unknown>;
  // just-bash Bash class has an exec method
  return typeof candidate.exec === "function";
}

/**
 * Wraps a just-bash Bash instance to conform to our Sandbox interface.
 */
export function wrapJustBash(bashInstance: JustBashLike): Sandbox {
  return {
    async executeCommand(command: string): Promise<CommandResult> {
      const result = await bashInstance.exec(command);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    },

    async readFile(filePath: string): Promise<string> {
      return bashInstance.fs.readFile(filePath);
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      await bashInstance.fs.writeFile(filePath, content);
    },
  };
}

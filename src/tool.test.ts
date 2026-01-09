import type { ToolExecutionOptions } from "ai";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "./types.js";

// AI SDK tool execute requires (args, options) - we provide test options
const opts: ToolExecutionOptions = { toolCallId: "test", messages: [] };

// Mock AI SDK
vi.mock("ai", () => ({
  tool: vi.fn((config) => ({
    description: config.description,
    inputSchema: config.inputSchema,
    execute: config.execute,
  })),
}));

// Mock just-bash with a simple in-memory implementation
const mockFiles: Record<string, string> = {};
let mockCwd = "/workspace";

vi.mock("just-bash", () => ({
  Bash: class MockBash {
    fs: {
      readFile: (path: string) => Promise<string>;
      writeFile: (path: string, content: string) => Promise<void>;
    };

    constructor(options: { files?: Record<string, string>; cwd?: string }) {
      Object.assign(mockFiles, options.files || {});
      mockCwd = options.cwd || "/workspace";

      this.fs = {
        readFile: async (path: string) => {
          if (mockFiles[path]) {
            return mockFiles[path];
          }
          throw new Error(`ENOENT: no such file: ${path}`);
        },
        writeFile: async (path: string, content: string) => {
          mockFiles[path] = content;
        },
      };
    }

    async exec(command: string) {
      if (command === "ls") {
        const files = Object.keys(mockFiles).join("\n");
        return { stdout: files, stderr: "", exitCode: 0 };
      }

      // Handle combined ls for bin directories (tool discovery)
      if (command.startsWith("ls /usr/bin /usr/local/bin")) {
        return {
          stdout:
            "/usr/bin:\ncat\ngrep\nsed\nawk\nhead\ntail\nsort\ncut\n/usr/local/bin:\njq\nyq",
          stderr: "",
          exitCode: 0,
        };
      }

      if (command === "pwd") {
        return { stdout: mockCwd, stderr: "", exitCode: 0 };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    }
  },
}));

import { createBashTool } from "./tool.js";

describe("createBashTool", () => {
  beforeEach(() => {
    // Clear mock files
    for (const key of Object.keys(mockFiles)) {
      delete mockFiles[key];
    }
  });

  it("creates toolkit with default just-bash sandbox", async () => {
    const { tools, sandbox } = await createBashTool();

    expect(tools.bash).toBeDefined();
    expect(tools.readFile).toBeDefined();
    expect(tools.writeFile).toBeDefined();
    expect(sandbox).toBeDefined();
    expect(typeof sandbox.executeCommand).toBe("function");
    expect(typeof sandbox.readFile).toBe("function");
    expect(typeof sandbox.writeFile).toBe("function");
  });

  it("writes inline files to destination", async () => {
    await createBashTool({
      files: {
        "src/index.ts": "export const x = 1;",
        "package.json": '{"name": "test"}',
      },
    });

    expect(mockFiles["/workspace/src/index.ts"]).toBe("export const x = 1;");
    expect(mockFiles["/workspace/package.json"]).toBe('{"name": "test"}');
  });

  it("uses custom destination", async () => {
    await createBashTool({
      destination: "/home/user/app",
      files: {
        "index.ts": "console.log('hello');",
      },
    });

    expect(mockFiles["/home/user/app/index.ts"]).toBe("console.log('hello');");
  });

  it("bash tool executes commands", async () => {
    const { tools } = await createBashTool({
      files: { "test.txt": "hello world" },
    });

    assert(tools.bash.execute, "bash.execute should be defined");
    const result = (await tools.bash.execute(
      { command: "ls" },
      opts,
    )) as CommandResult;
    expect(result.exitCode).toBe(0);
  });

  it("readFile tool reads files", async () => {
    const { tools } = await createBashTool({
      files: { "test.txt": "hello world" },
    });

    assert(tools.readFile.execute, "readFile.execute should be defined");
    const result = (await tools.readFile.execute(
      { path: "/workspace/test.txt" },
      opts,
    )) as { content: string };
    expect(result.content).toBe("hello world");
  });

  it("writeFile tool writes files", async () => {
    const { tools } = await createBashTool();

    assert(tools.writeFile.execute, "writeFile.execute should be defined");
    const result = (await tools.writeFile.execute(
      { path: "/workspace/new-file.txt", content: "new content" },
      opts,
    )) as { success: boolean };

    expect(result.success).toBe(true);
  });

  it("readFile tool resolves relative paths against cwd", async () => {
    const { tools } = await createBashTool({
      files: { "test.txt": "hello world" },
    });

    assert(tools.readFile.execute, "readFile.execute should be defined");
    // Use relative path - should resolve to /workspace/test.txt
    const result = (await tools.readFile.execute(
      { path: "test.txt" },
      opts,
    )) as { content: string };
    expect(result.content).toBe("hello world");
  });

  it("writeFile tool resolves relative paths against cwd", async () => {
    const { tools } = await createBashTool();

    assert(tools.writeFile.execute, "writeFile.execute should be defined");
    // Use relative path - should resolve to /workspace/relative.txt
    await tools.writeFile.execute(
      { path: "relative.txt", content: "relative content" },
      opts,
    );

    expect(mockFiles["/workspace/relative.txt"]).toBe("relative content");
  });

  it("readFile tool uses custom destination for relative paths", async () => {
    const { tools } = await createBashTool({
      destination: "/custom/dest",
      files: { "data.txt": "custom data" },
    });

    assert(tools.readFile.execute, "readFile.execute should be defined");
    const result = (await tools.readFile.execute(
      { path: "data.txt" },
      opts,
    )) as { content: string };
    expect(result.content).toBe("custom data");
  });

  it("writeFile tool uses custom destination for relative paths", async () => {
    const { tools } = await createBashTool({
      destination: "/custom/dest",
    });

    assert(tools.writeFile.execute, "writeFile.execute should be defined");
    await tools.writeFile.execute(
      { path: "new.txt", content: "new data" },
      opts,
    );

    expect(mockFiles["/custom/dest/new.txt"]).toBe("new data");
  });

  it("readFile tool preserves absolute paths", async () => {
    mockFiles["/absolute/path/file.txt"] = "absolute content";
    const { tools } = await createBashTool();

    assert(tools.readFile.execute, "readFile.execute should be defined");
    const result = (await tools.readFile.execute(
      { path: "/absolute/path/file.txt" },
      opts,
    )) as { content: string };
    expect(result.content).toBe("absolute content");
  });

  it("writeFile tool preserves absolute paths", async () => {
    const { tools } = await createBashTool();

    assert(tools.writeFile.execute, "writeFile.execute should be defined");
    await tools.writeFile.execute(
      { path: "/absolute/path/file.txt", content: "absolute content" },
      opts,
    );

    expect(mockFiles["/absolute/path/file.txt"]).toBe("absolute content");
  });

  it("calls onBeforeBashCall and onAfterBashCall callbacks", async () => {
    const onBeforeBashCall = vi.fn();
    const onAfterBashCall = vi.fn();
    const { tools } = await createBashTool({
      onBeforeBashCall,
      onAfterBashCall,
      files: { "test.txt": "hello" },
    });

    assert(tools.bash.execute, "bash.execute should be defined");

    await tools.bash.execute({ command: "ls" }, opts);

    expect(onBeforeBashCall).toHaveBeenCalledWith({ command: "ls" });
    expect(onAfterBashCall).toHaveBeenCalledWith({
      command: "ls",
      result: expect.objectContaining({ exitCode: expect.any(Number) }),
    });
  });

  it("allows onBeforeBashCall to modify command", async () => {
    const onBeforeBashCall = vi.fn().mockReturnValue({ command: "pwd" });
    const onAfterBashCall = vi.fn();
    const { tools } = await createBashTool({
      onBeforeBashCall,
      onAfterBashCall,
    });

    assert(tools.bash.execute, "bash.execute should be defined");

    await tools.bash.execute({ command: "ls" }, opts);

    // onBeforeBashCall receives the original command
    expect(onBeforeBashCall).toHaveBeenCalledWith({ command: "ls" });
    // onAfterBashCall receives the modified command
    expect(onAfterBashCall).toHaveBeenCalledWith({
      command: "pwd",
      result: expect.objectContaining({ exitCode: expect.any(Number) }),
    });
  });

  it("allows onAfterBashCall to modify result", async () => {
    const onAfterBashCall = vi.fn().mockReturnValue({
      result: { stdout: "modified output", stderr: "", exitCode: 42 },
    });
    const { tools } = await createBashTool({
      onAfterBashCall,
    });

    assert(tools.bash.execute, "bash.execute should be defined");

    const result = (await tools.bash.execute(
      { command: "echo test" },
      opts,
    )) as CommandResult;

    expect(result.stdout).toBe("modified output");
    expect(result.exitCode).toBe(42);
  });

  it("accepts custom Sandbox implementation", async () => {
    const customSandbox = {
      executeCommand: vi
        .fn()
        .mockResolvedValue({ stdout: "custom", stderr: "", exitCode: 0 }),
      readFile: vi.fn().mockResolvedValue("custom content"),
      writeFile: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    const { tools, sandbox } = await createBashTool({
      sandbox: customSandbox,
      files: { "test.txt": "content" },
    });

    expect(sandbox).toBe(customSandbox);

    // Files should be written to custom sandbox
    expect(customSandbox.writeFile).toHaveBeenCalledWith(
      "/workspace/test.txt",
      "content",
    );

    // Tools should use custom sandbox
    assert(tools.bash.execute, "bash.execute should be defined");
    const result = (await tools.bash.execute(
      { command: "ls" },
      opts,
    )) as CommandResult;
    expect(result.stdout).toBe("custom");
  });
});

describe("createBashTool tool prompt integration", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockFiles)) {
      delete mockFiles[key];
    }
  });

  it("includes available tools in bash tool description", async () => {
    const { tools } = await createBashTool({
      files: { "readme.txt": "hello" },
    });

    expect(
      tools.bash.description,
    ).toBe(`Execute bash commands in the sandbox environment.

WORKING DIRECTORY: /workspace
All commands execute from this directory. Use relative paths from here.

Available files:
  readme.txt

Available tools: awk, cat, cut, grep, head, jq, sed, sort, tail, yq, and more

Common operations:
  ls -la              # List files with details
  find . -name '*.ts' # Find files by pattern
  grep -r 'pattern' . # Search file contents
  cat <file>          # View file contents`);
  });

  it("includes format-specific hints for JSON files", async () => {
    const { tools } = await createBashTool({
      files: { "data.json": '{"key": "value"}' },
    });

    expect(
      tools.bash.description,
    ).toBe(`Execute bash commands in the sandbox environment.

WORKING DIRECTORY: /workspace
All commands execute from this directory. Use relative paths from here.

Available files:
  data.json

Available tools: awk, cat, cut, grep, head, jq, sed, sort, tail, yq, and more
For JSON: jq, grep, sed

Common operations:
  ls -la              # List files with details
  find . -name '*.ts' # Find files by pattern
  grep -r 'pattern' . # Search file contents
  cat <file>          # View file contents`);
  });

  it("includes format-specific hints for YAML files", async () => {
    const { tools } = await createBashTool({
      files: { "config.yaml": "key: value" },
    });

    expect(
      tools.bash.description,
    ).toBe(`Execute bash commands in the sandbox environment.

WORKING DIRECTORY: /workspace
All commands execute from this directory. Use relative paths from here.

Available files:
  config.yaml

Available tools: awk, cat, cut, grep, head, jq, sed, sort, tail, yq, and more
For YAML: yq, grep, sed

Common operations:
  ls -la              # List files with details
  find . -name '*.ts' # Find files by pattern
  grep -r 'pattern' . # Search file contents
  cat <file>          # View file contents`);
  });

  it("includes format-specific hints for multiple formats", async () => {
    const { tools } = await createBashTool({
      files: {
        "data.json": "{}",
        "config.yaml": "",
        "readme.md": "# Hello",
      },
    });

    expect(
      tools.bash.description,
    ).toBe(`Execute bash commands in the sandbox environment.

WORKING DIRECTORY: /workspace
All commands execute from this directory. Use relative paths from here.

Available files:
  data.json
  config.yaml
  readme.md

Available tools: awk, cat, cut, grep, head, jq, sed, sort, tail, yq, and more
For JSON: jq, grep, sed
For YAML: yq, grep, sed

Common operations:
  ls -la              # List files with details
  find . -name '*.ts' # Find files by pattern
  grep -r 'pattern' . # Search file contents
  cat <file>          # View file contents`);
  });

  it("includes yq for CSV when using just-bash sandbox", async () => {
    const { tools } = await createBashTool({
      files: { "data.csv": "a,b,c" },
    });

    // Default sandbox is just-bash, so yq should be included for CSV
    expect(
      tools.bash.description,
    ).toBe(`Execute bash commands in the sandbox environment.

WORKING DIRECTORY: /workspace
All commands execute from this directory. Use relative paths from here.

Available files:
  data.csv

Available tools: awk, cat, cut, grep, head, jq, sed, sort, tail, yq, and more
For CSV/TSV: yq, awk, cut

Common operations:
  ls -la              # List files with details
  find . -name '*.ts' # Find files by pattern
  grep -r 'pattern' . # Search file contents
  cat <file>          # View file contents`);
  });

  it("includes extraInstructions after tool prompt", async () => {
    const { tools } = await createBashTool({
      files: { "app.ts": "console.log('hi')" },
      extraInstructions: "Always use TypeScript.",
    });

    expect(
      tools.bash.description,
    ).toBe(`Execute bash commands in the sandbox environment.

WORKING DIRECTORY: /workspace
All commands execute from this directory. Use relative paths from here.

Available files:
  app.ts

Available tools: awk, cat, cut, grep, head, jq, sed, sort, tail, yq, and more

Common operations:
  ls -la              # List files with details
  find . -name '*.ts' # Find files by pattern
  grep -r 'pattern' . # Search file contents
  cat <file>          # View file contents

Always use TypeScript.`);
  });

  it("uses custom destination in description", async () => {
    const { tools } = await createBashTool({
      destination: "/home/user/project",
      files: { "index.ts": "" },
    });

    expect(tools.bash.description).toContain(
      "WORKING DIRECTORY: /home/user/project",
    );
    expect(tools.bash.description).toContain("Available tools:");
  });

  it("uses custom toolPrompt from promptOptions", async () => {
    const { tools } = await createBashTool({
      files: { "data.json": "{}" },
      promptOptions: {
        toolPrompt: "Custom tools: myTool, otherTool",
      },
    });

    expect(
      tools.bash.description,
    ).toBe(`Execute bash commands in the sandbox environment.

WORKING DIRECTORY: /workspace
All commands execute from this directory. Use relative paths from here.

Available files:
  data.json

Custom tools: myTool, otherTool

Common operations:
  ls -la              # List files with details
  find . -name '*.ts' # Find files by pattern
  grep -r 'pattern' . # Search file contents
  cat <file>          # View file contents`);
  });

  it("uses empty string toolPrompt to disable tool hints", async () => {
    const { tools } = await createBashTool({
      files: { "data.json": "{}" },
      promptOptions: {
        toolPrompt: "",
      },
    });

    expect(
      tools.bash.description,
    ).toBe(`Execute bash commands in the sandbox environment.

WORKING DIRECTORY: /workspace
All commands execute from this directory. Use relative paths from here.

Available files:
  data.json

Common operations:
  ls -la              # List files with details
  find . -name '*.ts' # Find files by pattern
  grep -r 'pattern' . # Search file contents
  cat <file>          # View file contents`);
  });

  it("combines custom toolPrompt with extraInstructions", async () => {
    const { tools } = await createBashTool({
      files: { "app.ts": "" },
      promptOptions: {
        toolPrompt: "Use: node, npm",
      },
      extraInstructions: "Always run tests first.",
    });

    expect(
      tools.bash.description,
    ).toBe(`Execute bash commands in the sandbox environment.

WORKING DIRECTORY: /workspace
All commands execute from this directory. Use relative paths from here.

Available files:
  app.ts

Use: node, npm

Common operations:
  ls -la              # List files with details
  find . -name '*.ts' # Find files by pattern
  grep -r 'pattern' . # Search file contents
  cat <file>          # View file contents

Always run tests first.`);
  });
});

/**
 * Type compatibility tests to ensure types work correctly.
 * These tests only check types at compile time - they don't run.
 */
import type { Sandbox as VercelSandbox } from "@vercel/sandbox";
import type { CreateBashToolOptions, Sandbox } from "../types.js";
import type { VercelSandboxLike } from "./vercel.js";

// Test: @vercel/sandbox Sandbox class is assignable to our VercelSandboxLike interface
function vercelSandboxMatchesOurInterface(sandbox: VercelSandbox) {
  const compatible: VercelSandboxLike = sandbox;
  return compatible;
}

// Test: @vercel/sandbox instance can be passed to createBashTool
function acceptsVercelSandbox(sandbox: VercelSandbox) {
  const options: CreateBashToolOptions = { sandbox };
  return options;
}

// Test: Our Sandbox interface methods are correctly typed
function ourSandboxIsValid(sandbox: Sandbox) {
  sandbox.executeCommand("ls");
  sandbox.readFile("/file");
  sandbox.writeFile("/file", "content");
}

// Suppress unused variable warnings
void vercelSandboxMatchesOurInterface;
void acceptsVercelSandbox;
void ourSandboxIsValid;

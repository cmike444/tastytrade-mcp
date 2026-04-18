import { format } from "node:util";

const isStdioMode = (process.env.MCP_TRANSPORT ?? "stdio") === "stdio";

function info(message: string, ...args: unknown[]): void {
  if (isStdioMode) {
    process.stderr.write(`[INFO] ${format(message, ...args)}\n`);
  } else {
    if (args.length) {
      console.log(message, ...args);
    } else {
      console.log(message);
    }
  }
}

function warn(message: string, ...args: unknown[]): void {
  if (isStdioMode) {
    process.stderr.write(`[WARN] ${format(message, ...args)}\n`);
  } else {
    if (args.length) {
      console.warn(message, ...args);
    } else {
      console.warn(message);
    }
  }
}

function error(message: string, ...args: unknown[]): void {
  if (args.length) {
    console.error(message, ...args);
  } else {
    console.error(message);
  }
}

export const logger = { info, warn, error };

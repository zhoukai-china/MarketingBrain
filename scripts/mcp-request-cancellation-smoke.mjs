import assert from "node:assert/strict";
import fs from "node:fs";

const mcpRoute = fs.readFileSync("apps/api/src/routes/mcp.ts", "utf8");

assert.match(mcpRoute, /const runController = new AbortController\(\)/, "MCP 调用必须创建可取消的执行控制器");
assert.match(mcpRoute, /request\.raw\.once\("aborted", abortRun\)/, "浏览器取消后，MCP 必须中止下游模型调用");
assert.match(mcpRoute, /signal: runController\.signal/, "MCP 必须把取消信号传给 Agent runtime");

console.log("MCP request cancellation smoke passed.");

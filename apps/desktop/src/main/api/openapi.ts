// An OpenAPI 3.1 document for the route table and the plugins' RPC methods.

import { jsonSchema } from "./body-schema.ts";
import { API, rpcPath } from "./routes.ts";
import type { Route, RpcInfo } from "./types.ts";

type Operations = Record<string, unknown>;

export function openApiDocument(routes: readonly Route[], title: string, rpc: readonly RpcInfo[] = []) {
  const paths: Record<string, Operations> = {};
  for (const route of routes) (paths[route.path] ??= {})[route.method.toLowerCase()] = routeOperation(route);
  for (const method of rpc) paths[rpcPath(method.plugin, method.name)] = { post: rpcOperation(method) };
  paths[`${API}/ws`] = {
    get: {
      summary: "WebSocket with real-time player updates (pass ?token= unless auth is off)",
      responses: { 101: { description: "Switching Protocols" } },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      version: "1.0.0",
      title,
      description: "Get an access token from `/auth/{id}` first to call the endpoints under `/api`.",
    },
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

function routeOperation(route: Route) {
  const params = [...route.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name,
    in: "path",
    required: true,
    schema: { type: name === "index" ? "integer" : "string" },
  }));
  const operation: Operations = {
    summary: route.summary,
    ...(route.public ? { security: [] } : {}),
    ...(params.length ? { parameters: params } : {}),
    responses: { 200: { description: "Success" }, 204: { description: "No content" } },
  };
  if (route.body && route.body !== "json") operation.requestBody = jsonBody(jsonSchema(route.body));
  return operation;
}

function rpcOperation(method: RpcInfo) {
  return {
    summary: method.summary ?? `${method.plugin}: ${method.name}`,
    tags: [`plugin: ${method.plugin}`],
    ...(method.input ? { requestBody: jsonBody(method.input) } : {}),
    responses: {
      200: { description: "The method's result" },
      400: { description: "Invalid input" },
      503: { description: "Plugin disabled" },
    },
  };
}

function jsonBody(schema: unknown) {
  return { required: true, content: { "application/json": { schema } } };
}

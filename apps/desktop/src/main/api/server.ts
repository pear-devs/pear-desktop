// HTTP(S) + WebSocket server for the route table: CORS, bearer auth, JSON
// bodies, the OpenAPI document and Swagger UI.

import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Duplex } from "node:stream";
import { errorMessage } from "@pear/sdk/util";
import { type WebSocket, WebSocketServer } from "ws";
import { verifyToken } from "./jwt.ts";
import { validateBody } from "./body-schema.ts";
import { openApiDocument } from "./openapi.ts";
import { API } from "./routes.ts";
import type { BodySchema, Reply, Route, RpcInfo } from "./types.ts";

export interface AuthConfig {
  authStrategy: "AUTH_AT_FIRST" | "NONE";
  secret: string;
  authorizedClients: readonly string[];
}

export interface ServerOptions {
  hostname: string;
  port: number;
  https?: { certPath: string; keyPath: string };
  routes: readonly Route[];
  /** Rebuilt per request, since plugins come and go. */
  rpcMethods(): readonly RpcInfo[];
  auth(): AuthConfig;
  /** A client connected to the WebSocket (already authenticated). */
  onSocket(socket: WebSocket): void;
  onError(error: unknown): void;
}

const WS_PATH = `${API}/ws`;
const MAX_BODY_BYTES = 1 << 20;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  // Lets web remotes on public origins reach a server on the local network.
  "Access-Control-Allow-Private-Network": "true",
};

const SWAGGER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Pear Desktop API</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: "/doc", dom_id: "#swagger-ui" });</script></body></html>`;

/** The WebSocket close codes the original used. */
const WS_POLICY_VIOLATION = 1008;
const WS_GOING_AWAY = 1001;

interface CompiledRoute {
  route: Route;
  pattern: RegExp;
  names: string[];
}

type Match = { route: Route; params: Record<string, string> } | { status: 404 | 405 };

export function isAuthorized(auth: AuthConfig, header: string | undefined | null, bearerOnly = true) {
  if (auth.authStrategy === "NONE") return true;
  const token = bearerOnly ? /^Bearer\s+(.+)$/i.exec(header ?? "")?.[1] : header;
  if (!token) return false;
  const payload = verifyToken(token, auth.secret);
  return !!payload && auth.authorizedClients.includes(payload.id);
}

/** Starts listening; resolves once bound (rejects on e.g. EADDRINUSE). */
export async function startServer(options: ServerOptions) {
  const listener = requestListener(options, compileRoutes(options.routes));
  const server: Server = options.https
    ? createHttpsServer({ key: readFileSync(options.https.keyPath), cert: readFileSync(options.https.certPath) }, listener)
    : createHttpServer(listener);
  const wss = attachWebSocket(server, options);
  await listen(server, options);
  return {
    server,
    sockets: wss.clients,
    close() {
      for (const client of wss.clients) client.close(WS_GOING_AWAY, "Server stopping");
      wss.close();
      server.close();
      server.closeAllConnections();
    },
  };
}

/** Path templates ("/queue/{index}") as regular expressions. */
function compileRoutes(routes: readonly Route[]): CompiledRoute[] {
  return routes.map((route) => {
    const names: string[] = [];
    const source = route.path.replace(/\{(\w+)\}/g, (_, name: string) => {
      names.push(name);
      return "([^/]+)";
    });
    return { route, pattern: new RegExp(`^${source}$`), names };
  });
}

/** The route for a request, or 405 when only the method is wrong, 404 otherwise. */
function matchRoute(compiled: readonly CompiledRoute[], method: string, pathname: string): Match {
  let pathExists = false;
  for (const { route, pattern, names } of compiled) {
    const found = pattern.exec(pathname);
    if (!found) continue;
    pathExists = true;
    if (route.method !== method) continue;
    return { route, params: Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(found[i + 1]!)])) };
  }
  return { status: pathExists ? 405 : 404 };
}

function requestListener(options: ServerOptions, compiled: readonly CompiledRoute[]) {
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    if (method === "OPTIONS") return sendReply(res, { status: 204 });
    if (method === "GET" && url.pathname === "/doc") {
      return sendReply(res, { status: 200, body: openApiDocument(options.routes, "Pear Desktop API Server", options.rpcMethods()) });
    }
    if (method === "GET" && url.pathname === "/swagger") return sendReply(res, { status: 200, body: SWAGGER_HTML });

    const match = matchRoute(compiled, method, url.pathname);
    if ("status" in match) return sendReply(res, { status: match.status, body: { error: "Not found" } });
    const { route, params } = match;
    if (!route.public && !isAuthorized(options.auth(), req.headers.authorization)) {
      res.writeHead(401, { ...CORS_HEADERS, "Content-Type": "text/plain" }).end("Unauthorized");
      return;
    }
    const body = route.body ? await readJsonBody(req, route.body) : { body: {} };
    if ("error" in body) return sendReply(res, { status: 400, body: { error: body.error } });
    sendReply(res, await route.handle({ params, body: body.body, remoteAddress: req.socket.remoteAddress ?? "unknown" }));
  };

  return (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((error: unknown) => {
      options.onError(error);
      if (!res.headersSent) sendReply(res, { status: 500, body: { error: errorMessage(error) } });
      else res.end();
    });
  };
}

/** The request's JSON body, checked against the schema; or what's wrong with it. */
async function readJsonBody(req: IncomingMessage, schema: BodySchema | "json"): Promise<{ body: Record<string, unknown> } | { error: string }> {
  let parsed: unknown;
  try {
    const text = await readBody(req);
    // RPC methods without input may be called with an empty body.
    parsed = schema === "json" && text.trim() === "" ? undefined : JSON.parse(text);
  } catch {
    return { error: "invalid JSON body" };
  }
  if (schema !== "json") {
    const error = validateBody(schema, parsed);
    if (error) return { error };
  }
  // Checked above, or (RPC calls) by the method's own input schema.
  return { body: parsed as Record<string, unknown> };
}

function sendReply(res: ServerResponse, { status, body }: Reply) {
  if (body === undefined || status === 204) {
    res.writeHead(status, CORS_HEADERS).end();
    return;
  }
  const isText = typeof body === "string";
  res
    .writeHead(status, { ...CORS_HEADERS, "Content-Type": isText ? "text/html; charset=utf-8" : "application/json" })
    .end(isText ? body : JSON.stringify(body));
}

function attachWebSocket(server: Server, options: ServerOptions) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== WS_PATH) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Like the original: accept, then close with a policy violation, so clients see why.
      if (!isAuthorized(options.auth(), url.searchParams.get("token"), false)) {
        ws.close(WS_POLICY_VIOLATION, "Unauthorized");
        return;
      }
      options.onSocket(ws);
    });
  });
  return wss;
}

function listen(server: Server, options: ServerOptions) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.hostname, () => {
      server.off("error", reject);
      server.on("error", options.onError);
      resolve();
    });
  });
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}


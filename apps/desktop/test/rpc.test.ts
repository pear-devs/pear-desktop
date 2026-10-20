import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, definePlugin } from "@pear/sdk";
import { toJsonSchema, v } from "@pear/sdk/rpc";
import { describe, expect, test, vi } from "vitest";
import { openApiDocument } from "../src/main/api/openapi.ts";
import { Settings } from "../src/main/config.ts";
import { MenuItems } from "../src/main/menu-items.ts";
import { PluginHost } from "../src/main/plugins.ts";

vi.mock("electron", () => ({}));

const greeter = definePlugin({
  id: "greeter",
  name: "Greeter",
  config: { greeting: config.string("Hello", { label: "Greeting" }) },
  host: {
    rpc: {
      greet: {
        summary: "Greets someone",
        input: v.object({ name: v.pipe(v.string(), v.minLength(1, "must not be empty")) }),
        run({ name }) {
          return { message: `${this.config.greeting}, ${name}!` };
        },
      },
    },
  },
});

async function setup(enabled = true) {
  const userData = mkdtempSync(join(tmpdir(), "pear-rpc-"));
  const settings = new Settings(userData, [greeter], "4.0.0");
  const host = new PluginHost([greeter], settings, "linux");
  const broadcast = vi.fn();
  host.attach({
    app: {} as never,
    window: {} as never,
    session: {} as never,
    router: { scoped: () => ({}), scopedSession: () => ({}), release() {} } as never,
    player: { state: {}, on: () => () => {}, control() {} } as never,
    requests: {} as never,
    send() {},
    openSettings() {},
    focusWindow() {},
    menuItems: new MenuItems(),
    broadcast,
    onProtocol: () => () => {},
    onDisabled() {},
  });
  if (enabled) await host.setEnabled("greeter", true);
  return { host, broadcast };
}

describe("plugin RPC", () => {
  test("calls the method with validated input and the plugin's context", async () => {
    const { host } = await setup();
    await expect(host.callRpc("greeter", "greet", { name: "Pear Desktop" })).resolves.toEqual({
      ok: true,
      value: { message: "Hello, Pear Desktop!" },
    });
    expect(host.rpcMethods().map(({ plugin, name }) => `${plugin}.${name}`)).toEqual(["greeter.greet"]);
  });

  test("rejects invalid input with the schema's messages", async () => {
    const { host } = await setup();
    await expect(host.callRpc("greeter", "greet", { name: "" })).resolves.toEqual({
      ok: false,
      status: 400,
      error: "name: must not be empty",
    });
    const missing = await host.callRpc("greeter", "greet", undefined);
    expect(missing).toMatchObject({ ok: false, status: 400 });
  });

  test("unknown methods are 404, disabled plugins 503 and unlisted", async () => {
    const { host } = await setup(false);
    await expect(host.callRpc("greeter", "nope", {})).resolves.toMatchObject({ status: 404 });
    await expect(host.callRpc("greeter", "toString", {})).resolves.toMatchObject({ status: 404 });
    await expect(host.callRpc("missing", "greet", {})).resolves.toMatchObject({ status: 404 });
    await expect(host.callRpc("greeter", "greet", { name: "x" })).resolves.toMatchObject({ status: 503 });
    expect(host.rpcMethods()).toEqual([]);
  });

  test("the OpenAPI document lists each method with its input schema", () => {
    const doc = openApiDocument([], "Test", [
      { plugin: "greeter", name: "greet", summary: "Greets someone", input: toJsonSchema(greeter.host!.rpc!.greet.input) },
    ]);
    const operation = (doc.paths["/api/v1/plugins/greeter/greet"] as any).post;
    expect(operation.summary).toBe("Greets someone");
    expect(operation.requestBody.content["application/json"].schema).toMatchObject({
      type: "object",
      properties: { name: { type: "string", minLength: 1 } },
      required: ["name"],
    });
  });
});

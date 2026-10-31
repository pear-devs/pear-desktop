// RPC methods a plugin exposes through the API server. Inputs arrive from the
// network, so each method validates them with a valibot schema; the schema also
// types `run`'s input and documents the method in the OpenAPI document.

import * as v from "valibot";

export { v };
export { toJsonSchema } from "@valibot/to-json-schema";

export interface RpcMethod<S extends v.GenericSchema = v.GenericSchema, This = unknown> {
  /** One line for the OpenAPI document. */
  summary?: string;
  /** Validates the JSON request body. */
  input: S;
  /** `this` is the plugin's host context. The result is sent back as JSON. */
  run(this: This, input: v.InferOutput<S>): unknown;
}

/** Method name → input schema, inferred from a plugin's `host.rpc`. */
export type RpcSchemas = Record<string, v.GenericSchema>;

export type RpcMethods<R extends RpcSchemas, This> = { [K in keyof R]: RpcMethod<R[K], This> };

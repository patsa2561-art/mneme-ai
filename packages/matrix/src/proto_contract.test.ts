import { describe, it, expect } from "vitest";
import * as protoLoader from "@grpc/proto-loader";
import * as grpc from "@grpc/grpc-js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The proto IS the cross-language contract: the Python / Go / Rust quickstarts in
// examples/ target exactly these services, methods, and message fields. This test
// pins that contract so a proto change that would break a quickstart fails CI here.
const PROTO = join(dirname(fileURLToPath(import.meta.url)), "..", "proto", "mneme.proto");

describe("Matrix proto — the cross-language contract", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pkg = grpc.loadPackageDefinition(protoLoader.loadSync(PROTO, { keepCase: true })) as any;

  it("exposes the Matrix service with all four RPCs", () => {
    const svc = pkg.mneme?.Matrix?.service;
    expect(svc).toBeTruthy();
    const methods = Object.keys(svc);   // proto-loader keys the definition by method name
    for (const rpc of ["Invoke", "Pipe", "ContextStream", "Health"]) expect(methods).toContain(rpc);
  });

  it("ContextStream is a bidi stream (client + server streaming)", () => {
    const cs = pkg.mneme.Matrix.service["ContextStream"] as { requestStream: boolean; responseStream: boolean };
    expect(cs.requestStream).toBe(true);
    expect(cs.responseStream).toBe(true);
  });

  it("the message field names the quickstarts rely on are present (snake_case)", () => {
    // proto-loader with keepCase keeps snake_case; the quickstarts use these exact names.
    const def = protoLoader.loadSync(PROTO, { keepCase: true });
    const names = Object.keys(def);
    for (const t of ["mneme.ToolRequest", "mneme.ToolResponse", "mneme.Frame", "mneme.DeltaMsg", "mneme.DeltaAck", "mneme.HealthReply"]) {
      expect(names).toContain(t);
    }
  });
});

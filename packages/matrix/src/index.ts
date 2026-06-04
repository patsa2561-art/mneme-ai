/**
 * @mneme-ai/matrix — THE MATRIX RAIL gRPC wire server (local-first).
 * One typed, signed, streaming pipe any AI agent (any language) crosses to reach
 * every Mneme function. Wraps @mneme-ai/core's pipe core. See docs/MATRIX.md.
 */
export { createMatrixServer, buildImpl, type ServeOptions, type RunningServer } from "./server.js";
export { connect, health, invoke, pipeInvoke, type MatrixClient, type ToolReply } from "./client.js";
export { grpcGauntlet, type GrpcGauntlet } from "./gauntlet.js";

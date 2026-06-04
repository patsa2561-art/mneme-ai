# Matrix Rail — any-language quickstarts

The Matrix Rail is local-first gRPC (`127.0.0.1`). Any language that speaks gRPC +
the [`mneme.proto`](../proto/mneme.proto) contract reaches **every Mneme tool**
through one typed door — and the delta channel for long context loops.

Three reference clients, each doing the same three things — **Health**, a unary
**Invoke** (the typed door; the reply carries an Ed25519 proof you verify offline),
and the **ContextStream** delta channel (open with a snapshot, stream tiny splice
ops, get a compact ack per op):

| Language | File | Generate stubs | Run |
|---|---|---|---|
| Python | [`client.py`](client.py) | `python -m grpc_tools.protoc -I../proto --python_out=. --grpc_python_out=. ../proto/mneme.proto` | `python client.py 127.0.0.1:50777` |
| Go | [`client.go`](client.go) | `protoc -I../proto --go_out=. --go-grpc_out=. ../proto/mneme.proto` | `go run client.go 127.0.0.1:50777` |
| Rust | [`client.rs`](client.rs) | `tonic-build` in `build.rs` (compiles the proto) | `cargo run -- 127.0.0.1:50777` |

Start the rail first (from the repo root):

```bash
mneme matrix serve --port 50777     # 127.0.0.1 only; Ctrl-C to stop
```

The **TypeScript** reference client is [`../src/client.ts`](../src/client.ts)
(`connect` · `health` · `invoke` · `verifyReply` · `pipeInvoke` · `contextStream`).
The proto contract these quickstarts target is pinned by a test
(`src/proto_contract.test.ts`) so a breaking proto change fails CI.

> Honest scope: these are runnable reference clients + the pinned contract — not a
> CI matrix that compiles Go/Rust/Python on every push. The wire format
> (`keepCase` snake_case fields) is stable and tested from the TS side.

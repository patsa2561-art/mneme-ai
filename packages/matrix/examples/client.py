#!/usr/bin/env python3
"""
Matrix Rail — Python quickstart.

The rail is local-first gRPC (127.0.0.1). Any language that speaks gRPC + the
mneme.proto contract reaches EVERY Mneme tool. This example: Health, a unary
Invoke (with offline proof check), and the ContextStream delta channel.

Setup (once):
    pip install grpcio grpcio-tools
    python -m grpc_tools.protoc -I../proto --python_out=. --grpc_python_out=. ../proto/mneme.proto
    # → generates mneme_pb2.py + mneme_pb2_grpc.py

Run the rail (from the repo):  mneme matrix serve --port 50777
Then:                          python client.py 127.0.0.1:50777
"""
import sys, json, hashlib
import grpc
import mneme_pb2 as pb
import mneme_pb2_grpc as rpc


def main(addr: str) -> None:
    with grpc.insecure_channel(addr) as ch:
        stub = rpc.MatrixStub(ch)

        # 1) Health — confirm the rail + how many tools it bridges
        h = stub.Health(pb.HealthRequest())
        print(f"health: ok={h.ok} version={h.version} tools={h.tools} trustless={h.trustless}")

        # 2) Invoke — the typed door to any tool. Reply carries an Ed25519 proof.
        resp = stub.Invoke(pb.ToolRequest(tool="mneme.savant.verify",
                                          args_json=json.dumps({"claim": "2 + 2 = 4"})))
        print(f"invoke ok={resp.ok} wisdom={resp.wisdom[:80]}")
        # verify the proof OFFLINE (the receipt commits to sha256(data)); see verifyReply in client.ts
        if resp.proof_json:
            proof = json.loads(resp.proof_json)
            print(f"  proof dataHash present: {bool(proof.get('dataHash'))}")

        # 3) ContextStream — the delta channel: open with a snapshot, stream tiny
        #    splice ops, get a COMPACT ack per op (hash + sizes, never the whole doc).
        base = "const a = 1;\n" * 200

        def msgs():
            yield pb.DeltaMsg(channel_id="c1", snapshot=True, base=base)
            for i in range(10):
                op = {"at": (i * 17) % len(base), "del": i % 2, "ins": f"/*{i}*/"}
                yield pb.DeltaMsg(channel_id="c1", snapshot=False, op_json=json.dumps(op))

        for ack in stub.ContextStream(msgs()):
            if ack.doc_hash:
                print(f"  delta ack: {ack.delta_bytes}B sent, doc now {ack.doc_len} chars, hash {ack.doc_hash[:12]}…")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1:50777")

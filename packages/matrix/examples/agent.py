#!/usr/bin/env python3
"""
Matrix Rail — a COMPLETE reference AI agent (Python), end to end.

This is the world-stage demonstration of how ANY agent, in ANY language, uses
Mneme over local gRPC WITHOUT knowing a single tool name in advance, and trusts
NOTHING it can't verify itself:

    1. Health      — confirm the rail is up (loopback, proof-carrying)
    2. Search      — plain-language INTENT -> the right tool(s), ranked
                     (BM25 + curated-trigger wisdom on the server; no LLM)
    3. ListTools   — fetch the chosen tool's JSON Schema (how to call it right)
    4. Invoke      — call it; the reply carries an Ed25519 proof
    5. verify      — check that proof OFFLINE, in pure Python, with the embedded
                     public key only: no Mneme, no network, no shared secret

Generate the stubs once (from packages/matrix/examples):
    python -m grpc_tools.protoc -I../proto \
        --python_out=. --grpc_python_out=. ../proto/mneme.proto

Run (start the rail first: `mneme matrix serve --port 50561`):
    pip install grpcio cryptography           # cryptography is optional (see below)
    python agent.py --intent "is this repo safe to depend on"

The Ed25519 step uses `cryptography`; without it the agent still proves DATA
INTEGRITY (the hash binding) in pure stdlib and tells you how to get the full
signature check. The verification logic mirrors the CI-tested TypeScript
`verifyReply` in ../src/client.ts byte-for-byte.
"""
from __future__ import annotations
import argparse, base64, hashlib, json, os, sys
import grpc
import mneme_pb2 as pb
import mneme_pb2_grpc as rpc


# ── canonical JSON — MUST match notary/receipt.ts canonicalJson exactly ──────────
# Recursively sort object keys, drop undefined (Python: drop None only at the value
# level is NOT done by JS; JS keeps null), compact separators, keep unicode.
def canonical(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return json.dumps(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ",".join(canonical(x) for x in v) + "]"
    if isinstance(v, dict):
        keys = sorted(k for k in v.keys() if v[k] is not None)
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canonical(v[k]) for k in keys) + "}"
    return "null"


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def verify_proof(data: dict, proof: dict) -> tuple[bool, str]:
    """Offline verification — the same 4 checks as trustless.verifyToolResult."""
    if not proof or "receipt" not in proof or not isinstance(proof.get("dataHash"), str):
        return False, "no _proof — unverifiable (you would have to TRUST this result)"
    receipt = proof["receipt"]
    # 3) the data (minus _proof) hashes to the committed dataHash  (integrity)
    if sha256_hex(canonical(data)) != proof["dataHash"]:
        return False, "data does not match the signed dataHash (tampered)"
    # 2) the receipt commits to that dataHash  (binding)
    inner = sha256_hex(canonical({"dataHash": proof["dataHash"]}))
    if receipt.get("payloadHash") != inner:
        return False, "receipt does not commit to this dataHash (forged/swapped proof)"
    # receiptId integrity — the signed body
    body = {
        "v": receipt.get("v"), "alg": receipt.get("alg"), "kind": receipt.get("kind"),
        "subject": receipt.get("subject"), "payloadHash": receipt.get("payloadHash"),
        "issuer": receipt.get("issuer"), "issuerFingerprint": receipt.get("issuerFingerprint"),
        "issuedAt": receipt.get("issuedAt"), "prev": receipt.get("prev") or None,
    }
    if sha256_hex(canonical(body)) != receipt.get("receiptId"):
        return False, "receiptId does not match the canonical body (tampered receipt)"
    # 1) Ed25519 signature over the receiptId bytes, with the EMBEDDED public key
    try:
        from cryptography.hazmat.primitives.serialization import load_der_public_key
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        pub = load_der_public_key(base64.b64decode(receipt["issuer"]))
        if not isinstance(pub, Ed25519PublicKey):
            return False, "issuer key is not Ed25519"
        pub.verify(base64.b64decode(receipt["sig"]), bytes.fromhex(receipt["receiptId"]))
        return True, f"genuine + untampered (Ed25519 verified offline · issuer {receipt.get('issuerFingerprint')})"
    except ImportError:
        return True, "integrity + binding verified (pure stdlib). For the Ed25519 signature check: pip install cryptography"
    except Exception as e:  # noqa: BLE001
        return False, f"Ed25519 signature invalid: {e}"


def discover_addr() -> str:
    """Zero-config: read the running rail's port from .mneme/matrix.json if present."""
    for root in (os.getcwd(), os.path.dirname(os.getcwd())):
        disc = os.path.join(root, ".mneme", "matrix.json")
        if os.path.exists(disc):
            try:
                j = json.load(open(disc, encoding="utf-8"))
                if j.get("port"):
                    return f"127.0.0.1:{j['port']}"
            except Exception:  # noqa: BLE001
                pass
    return "127.0.0.1:50561"


def main() -> int:
    ap = argparse.ArgumentParser(description="Matrix Rail reference agent")
    ap.add_argument("--addr", default=None, help="host:port (default: auto-discover or 127.0.0.1:50561)")
    ap.add_argument("--intent", default="verify that a claim is actually true", help="what you WANT, in plain language")
    ap.add_argument("--tool", default=None, help="skip search; invoke this tool directly")
    ap.add_argument("--args", default="{}", help="JSON args for the tool")
    a = ap.parse_args()
    addr = a.addr or discover_addr()

    chan = grpc.insecure_channel(addr, options=[
        ("grpc.max_receive_message_length", 8 * 1024 * 1024),
        ("grpc.max_send_message_length", 8 * 1024 * 1024),
    ])
    stub = rpc.MatrixStub(chan)

    # 1) HEALTH
    h = stub.Health(pb.HealthRequest())
    print(f"① health      ✓ Mneme v{h.version} · {h.tools} tools · trustless={h.trustless}  @ {addr}")
    if not h.ok:
        print("rail not healthy", file=sys.stderr); return 2

    # 2) SEARCH — intent -> tool (autonomous discovery)
    tool = a.tool
    if not tool:
        sr = stub.Search(pb.SearchRequest(intent=a.intent, limit=5))
        if not sr.hits:
            print(f"② search      ✗ no tool matched “{a.intent}”"); return 2
        print(f"② search      “{a.intent}” →")
        for hit in sr.hits:
            print(f"               {hit.score:6.2f}  {hit.name}   ({hit.why})")
        tool = sr.hits[0].name
        print(f"               ▶ chose: {tool}")

    # 3) LISTTOOLS — fetch the chosen tool's JSON Schema
    lt = stub.ListTools(pb.ListToolsRequest(query=tool, limit=5))
    info = next((t for t in lt.tools if t.name == tool), lt.tools[0] if lt.tools else None)
    if info:
        schema = json.loads(info.input_schema_json or "{}")
        props = list((schema.get("properties") or {}).keys())
        print(f"③ schema      {info.name} · args: {props or '(none)'}")

    # 4) INVOKE — the typed door
    reply = stub.Invoke(pb.ToolRequest(tool=tool, args_json=a.args))
    if not reply.ok:
        print(f"④ invoke      ✗ {reply.error}"); return 2
    data = json.loads(reply.data_json or "{}")
    print(f"④ invoke      ✓ {tool}  →  {json.dumps(data)[:120]}")
    if reply.customs_json:
        c = json.loads(reply.customs_json)
        flag = "QUARANTINED" if c.get("quarantined") else ("flagged" if c.get("findings") else "clean")
        print(f"               customs: {flag}{' · ' + str(c.get('findings')) if c.get('findings') else ''}")

    # 5) VERIFY — offline, with the embedded public key only (trust nothing)
    proof = json.loads(reply.proof_json) if reply.proof_json else None
    ok, why = verify_proof(data, proof)
    print(f"⑤ verify      {'✓' if ok else '✗'} {why}")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())

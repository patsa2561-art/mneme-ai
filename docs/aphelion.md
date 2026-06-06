# 🛰 APHELION — the agent brain that goes farther than the cloud

> ἀφήλιον — the point in an orbit farthest from the sun. Mneme's APHELION is the agent brain at the
> farthest point from the cloud: Mars latency, a severed Starlink link, an air-gapped facility.

Every AI governance and memory layer ever built assumes the cloud is one round-trip away. An agent on
Mars (4–24 minutes of light-delay each way), on a dropped link, or behind an air-gap **cannot ask
Earth before it acts**. It has to govern *itself* against a local charter, keep a tamper-evident
record of everything it did while no one was watching, and — when the link returns — hand back **one
signed proof of the whole disconnected window** that an operator verifies *offline*, then merge
cleanly with the rest of the fleet.

Mneme is local-first, signed, and offline-verifiable by design, so it already holds the hard parts.
APHELION composes them into the disconnected-ops primitive.

```bash
# the rover loses contact with Earth and governs itself against a local charter
mneme aphelion open --node rover --mission survey \
      --scope "sensors/*" "nav/*" --forbidden self-destruct --max-risk 0.7

mneme aphelion act --node rover --action "read sensor" --risk 0.1 --path sensors/temp   # 🟢 within charter
mneme aphelion act --node rover --action "plan route"  --risk 0.4 --path nav/route       # 🟢 within charter
mneme aphelion act --node rover --action "self-destruct" --risk 0.9 --path core          # 🔴 CHARTER VIOLATION

# Earth reconnects — seal the window, verify offline, merge the fleet
mneme aphelion seal   --node rover                 # → a signed capsule; the violation cannot be hidden
mneme aphelion verify rover.capsule.json           # ✓ WINDOW VERIFIED (Ed25519, offline)
mneme aphelion merge  rover.capsule.json probe2.capsule.json   # 🛰 FLEET MERGE · per-node compliance
```

## How it works

- **Charter** — the local autonomy envelope: `{ mission, scope[], forbidden[], maxRisk }`. The agent's
  conscience while off-grid.
- **Self-gated ledger** — every action is judged against the charter (`forbidden` / `maxRisk` /
  `scope`) and appended to a **hash-chained** ledger. A forbidden, over-risk, or off-scope action is
  recorded as a **violation** — the agent acted (it's autonomous), but the record is permanent.
- **Sealed capsule** — `sealCapsule` produces a signed artifact with the chain head, the time window,
  and a compliance summary; `verifyCapsule` re-verifies the chain **and re-derives every judgement**,
  so a violation flipped to "compliant" is caught.
- **Fleet CRDT merge** — `mergeCapsules` unions actions by id across nodes (idempotent + commutative),
  giving one conflict-free fleet view with per-node compliance on reconnect.

Composes with **Infra Provenance** (the capsule carries *where* the node ran) and the
**Accountability Dossier** (the capsule is one section of an agent's full, offline-verifiable record).

## The honest line (DIAKRISIS)

APHELION proves what the agent **recorded against its charter** — a tamper-evident, offline-verifiable
operations log plus a conflict-free fleet merge. It is **not** a claim that the agent could be
physically stopped mid-action while disconnected (it can't — that is the nature of autonomy). The
value is precise and real: a charter **violation cannot be hidden** after the fact, and a clean window
is **provable**. `aphelionGauntlet=100`.

# 🛰 Infra Provenance — rent the muscle, keep the soul

Compute is becoming a rented, shared, migrating commodity — rivals run on each other's GPUs, a
workload on one vendor's silicon today and another's tomorrow. That breaks a question nobody has a
neutral answer to: **where did my agent actually run, and when — and did it quietly migrate** to a
different provider or region mid-task? Each cloud can attest only its own metal. A buyer, an auditor,
or a regulator (EU AI Act data-residency) needs a record **no single vendor owns**. Mneme — owned by
no vendor — mints it.

```bash
mneme infra                              # where am I running right now (provider/region/gpu), hashed host
mneme infra attest --out infra.json      # a NOTARY-signed attestation, verifiable offline
mneme infra residency --allow eu- europe-   # data-residency gate (exit 2 if outside policy)
```

Over HTTP for any vendor (on `gephyra serve`): `POST /agent/infra` returns the signed attestation
(and an optional residency verdict), and **`POST /agent/cert/build` now binds the infra attestation
into the Agent Run Certificate** — so a run's proof of *governance* and its proof of *where it ran*
travel together.

## What it captures

A deterministic read of the signals the host exposes — cloud env markers (GCP Cloud Run, AWS Lambda,
Azure, CoreWeave, RunPod, Modal, Lambda Labs, Oracle, Kubernetes), region, service, an NVIDIA-GPU
hint, platform/arch/cpu, and a one-way **hash** of the hostname. Then:

- **`infraDrift(a, b)`** — compares two captures; a `provider` / `region` / `host` change is a
  migration signal, reported with the exact diff (`provider gcp→aws, region europe-west1→us-east-1`).
- **`dataResidencyCheck(att, allowed)`** — `allowed` entries match a region, a prefix (`eu-`), or a
  `provider:*` wildcard; an **unknown region is denied by default** under a policy.

## The honest line (DIAKRISIS)

Infra Provenance attests the execution environment **as the host declares it** (its env vars + OS
facts) — it is **not** a TEE / hardware remote-attestation that cryptographically proves the silicon
is genuine. The value is real and unmet: a **neutral, signed, portable WHERE+WHEN** you can verify
offline, plus a tamper-evident **drift** signal — not a proof of the metal. Nothing sensitive leaks:
the hostname is hashed, and the recorded signals are env-var **names only**, never their values.
`infraProvenanceGauntlet=100`.

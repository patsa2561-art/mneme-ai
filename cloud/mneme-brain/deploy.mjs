#!/usr/bin/env node
// Deploy mneme-brain to a DigitalOcean droplet via the DO API.
//
// Reads DO PAT from env var DO_PAT (NEVER pass on CLI / commit to git).
// Reads cloud-init.yaml + uploads as user_data on droplet recreation.
//
// Modes:
//   node deploy.mjs status                    → show current droplet + brain health
//   node deploy.mjs rebuild <droplet-id>      → destroy + recreate with cloud-init
//   node deploy.mjs create                    → fresh droplet (default size: s-2vcpu-2gb sgp1)
//   node deploy.mjs destroy <droplet-id>      → tear down (also use to clean up tests)
//
// FREE-FIRST design: defaults to the smallest billable size that runs
// Node 22 + Caddy comfortably ($18/mo s-2vcpu-2gb). All Mneme Cloud
// Phase 4 features remain free for end users; this droplet is the
// shared cloud relay you (the user) host.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLOUD_INIT_FILE = join(SCRIPT_DIR, "cloud-init.yaml");
const DO_API = "https://api.digitalocean.com/v2";

const TOKEN = process.env.DO_PAT;
if (!TOKEN) {
  console.error("✗ Set DO_PAT env var first. Example (PowerShell):");
  console.error('    $env:DO_PAT = "dop_v1_..."');
  console.error("    node deploy.mjs status");
  process.exit(2);
}

async function api(method, path, body) {
  const res = await fetch(`${DO_API}${path}`, {
    method,
    headers: {
      "authorization": `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`DO API ${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function listDroplets() {
  const r = await api("GET", "/droplets?page=1&per_page=200");
  return r.droplets ?? [];
}

async function findBrainDroplet() {
  const all = await listDroplets();
  // Match by name = "mneme-brain" first, else any droplet currently
  // tagged with mneme-cloud, else fall back to first running droplet.
  return (
    all.find((d) => d.name === "mneme-brain") ||
    all.find((d) => Array.isArray(d.tags) && d.tags.includes("mneme-cloud")) ||
    all.find((d) => d.status === "active") ||
    null
  );
}

function publicIp(droplet) {
  const v4 = droplet?.networks?.v4 ?? [];
  return v4.find((n) => n.type === "public")?.ip_address ?? null;
}

async function checkBrain(ip) {
  if (!ip) return { ok: false, reason: "no-ip" };
  // v1.42.3 MVP runs HTTP on :8080 (no Caddy / TLS yet — that lands in
  // v1.43.x once a domain is registered). Try :8080 first, then :443
  // for forward-compat with the eventual TLS setup.
  for (const url of [`http://${ip}:8080/v1/healthz`, `https://${ip}/v1/healthz`]) {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(5000) });
      const json = await res.json().catch(() => null);
      if (res.ok) return { ok: true, status: res.status, body: json, url };
    } catch { /* try next */ }
  }
  return { ok: false, reason: "no /v1/healthz reachable on :8080 or :443" };
}

async function cmdStatus() {
  const drop = await findBrainDroplet();
  if (!drop) { console.log("(no mneme-brain droplet found in your DO account)"); return; }
  const ip = publicIp(drop);
  console.log(`droplet:  ${drop.name} #${drop.id}  size=${drop.size_slug}  region=${drop.region.slug}  status=${drop.status}`);
  console.log(`ipv4:     ${ip ?? "(none)"}`);
  console.log(`tags:     ${(drop.tags ?? []).join(", ") || "(none)"}`);
  if (ip) {
    process.stdout.write("brain:    ");
    const h = await checkBrain(ip);
    if (h.ok) console.log(`✓ healthy (v${h.body?.version ?? "?"})`);
    else console.log(`✗ unreachable (${h.reason ?? h.status})`);
  }
}

function readCloudInit() {
  if (!existsSync(CLOUD_INIT_FILE)) {
    throw new Error(`cloud-init file missing at ${CLOUD_INIT_FILE}`);
  }
  return readFileSync(CLOUD_INIT_FILE, "utf8");
}

async function getSshKeyIds() {
  const r = await api("GET", "/account/keys");
  return (r.ssh_keys ?? []).map((k) => k.id);
}

async function cmdCreate(opts = {}) {
  const userData = readCloudInit();
  const sshKeys = await getSshKeyIds();
  const body = {
    name: opts.name ?? "mneme-brain",
    region: opts.region ?? "sgp1",
    size: opts.size ?? "s-2vcpu-2gb",
    image: "ubuntu-24-04-x64",
    user_data: userData,
    tags: ["mneme-cloud", "mneme-brain"],
    monitoring: true,
    ipv6: false,
    backups: false,
    ssh_keys: sshKeys,   // attach every key on the account so you can SSH in for debugging
  };
  console.log(`Creating mneme-brain droplet (${body.size} @ ${body.region}, ssh_keys=${sshKeys.length})…`);
  const r = await api("POST", "/droplets", body);
  console.log(`✓ Created droplet #${r.droplet.id} — boot will take ~60-90s, cloud-init ~3-5 min more.`);
  console.log(`Watch: node deploy.mjs status   (re-run every minute until brain shows ✓ healthy)`);
}

async function cmdDestroy(id) {
  if (!id) throw new Error("destroy needs <droplet-id>");
  await api("DELETE", `/droplets/${id}`);
  console.log(`✓ Destroyed droplet #${id}`);
}

async function cmdRebuild(idArg) {
  const drop = idArg ? { id: Number(idArg) } : await findBrainDroplet();
  if (!drop) throw new Error("no droplet to rebuild — pass <droplet-id> or run create first");
  console.log(`Destroying droplet #${drop.id}…`);
  await api("DELETE", `/droplets/${drop.id}`);
  console.log(`Waiting 10s for billing/state to settle…`);
  await new Promise((r) => setTimeout(r, 10_000));
  await cmdCreate({ name: "mneme-brain" });
}

const cmd = process.argv[2] ?? "status";
const arg = process.argv[3];

(async () => {
  try {
    if (cmd === "status")  return await cmdStatus();
    if (cmd === "create")  return await cmdCreate();
    if (cmd === "destroy") return await cmdDestroy(arg);
    if (cmd === "rebuild") return await cmdRebuild(arg);
    console.error(`Unknown command: ${cmd}. Try: status | create | destroy <id> | rebuild [id]`);
    process.exit(2);
  } catch (e) {
    console.error(`✗ ${e?.message ?? e}`);
    process.exit(1);
  }
})();

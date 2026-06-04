// Matrix Rail — Rust quickstart (tonic).
//
// The rail is local-first gRPC (127.0.0.1). Any gRPC-speaking language with the
// mneme.proto contract reaches EVERY Mneme tool. Shows Health, a unary Invoke,
// and the ContextStream delta channel.
//
// Cargo.toml:
//   [dependencies]
//   tonic = "0.12"
//   prost = "0.13"
//   tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
//   serde_json = "1"
//   [build-dependencies]
//   tonic-build = "0.12"
//
// build.rs:
//   fn main() { tonic_build::compile_protos("../proto/mneme.proto").unwrap(); }
//
// Run the rail:  mneme matrix serve --port 50777
// Then:          cargo run -- 127.0.0.1:50777
use mneme::matrix_client::MatrixClient;
use mneme::{DeltaMsg, HealthRequest, ToolRequest};

pub mod mneme {
    tonic::include_proto!("mneme");
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = std::env::args().nth(1).unwrap_or_else(|| "127.0.0.1:50777".into());
    let mut client = MatrixClient::connect(format!("http://{addr}")).await?;

    // 1) Health
    let h = client.health(HealthRequest {}).await?.into_inner();
    println!("health: ok={} version={} tools={} trustless={}", h.ok, h.version, h.tools, h.trustless);

    // 2) Invoke — the typed door; reply carries an Ed25519 proof in proof_json.
    let args = serde_json::json!({ "claim": "2 + 2 = 4" }).to_string();
    let r = client
        .invoke(ToolRequest { tool: "mneme.savant.verify".into(), args_json: args, held_root: String::new() })
        .await?
        .into_inner();
    println!("invoke ok={} wisdom={}", r.ok, &r.wisdom.chars().take(80).collect::<String>());

    // 3) ContextStream — the delta channel (snapshot, then stream splice ops).
    let base: String = "const a = 1;\n".repeat(200);
    let base_for_stream = base.clone();
    let outbound = async_stream::stream! {
        yield DeltaMsg { channel_id: "c1".into(), snapshot: true, base: base_for_stream.clone(), op_json: String::new() };
        for i in 0..10usize {
            let op = serde_json::json!({ "at": (i * 17) % base_for_stream.len(), "del": i % 2, "ins": format!("/*{i}*/") }).to_string();
            yield DeltaMsg { channel_id: "c1".into(), snapshot: false, base: String::new(), op_json: op };
        }
    };
    let mut acks = client.context_stream(outbound).await?.into_inner();
    while let Some(ack) = acks.message().await? {
        if !ack.doc_hash.is_empty() {
            println!("  delta ack: {}B sent, doc now {} chars, hash {}…", ack.delta_bytes, ack.doc_len, &ack.doc_hash[..12]);
        }
    }
    Ok(())
}

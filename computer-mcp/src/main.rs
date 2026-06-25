//! AgentDesk computer-use sidecar binary (docs/computer-use-design.md). Thin wrapper over the
//! `computer_mcp` lib. The stdio MCP server loop (capture → ground → denorm → gate → inject) is the
//! next phase-3 commit; the end-to-end pipeline is exercised today via `examples/act_demo.rs`.

fn main() {
    eprintln!(
        "computer-mcp {}: the stdio MCP server is not yet wired (phase 3). The capture→ground→inject \
         pipeline runs via `cargo run --example act_demo`. See docs/computer-use-design.md.",
        env!("CARGO_PKG_VERSION")
    );
    std::process::exit(1);
}

//! AgentDesk computer-use sidecar (docs/computer-use-design.md). A local stdio MCP server that
//! exposes intent-level tools (`computer_act` / `computer_observe` / `computer_wait`), grounds
//! screenshots via a configured vision model through the gateway, and drives the local desktop.
//!
//! Phase 3 status: the pure, OS-agnostic cores land first (coordinate denormalization here; safety
//! gates next). The stdio MCP loop + xcap capture + enigo injection + the gateway grounding client
//! are added in later commits and need real-machine + gateway integration testing.

// Pure logic is implemented + unit-tested ahead of the integration layer that consumes it.
#[allow(dead_code)]
mod coords;
#[allow(dead_code)]
mod safety;
#[allow(dead_code)]
mod capture;
#[allow(dead_code)]
mod inject;

fn main() {
    eprintln!(
        "computer-mcp {}: scaffold only — the stdio MCP server (capture/ground/inject) is not yet \
         wired (phase 3). See docs/computer-use-design.md.",
        env!("CARGO_PKG_VERSION")
    );
    std::process::exit(1);
}

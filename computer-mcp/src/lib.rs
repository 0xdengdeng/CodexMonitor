//! computer-mcp library (docs/computer-use-design.md). The pure cores (coords/safety) + the OS
//! mechanism (capture/inject). The `computer-mcp` binary is a thin wrapper; examples and integration
//! tests link against this lib.

pub mod capture;
pub mod coords;
pub mod inject;
pub mod safety;
pub mod vision;

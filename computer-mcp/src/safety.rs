//! Server-side safety gate (docs/computer-use-design.md §7).
//!
//! The codex approval card is **advisory only** (codex offers "always-allow", so per-action prompts
//! are not enforceable there). The real gate lives here, in the sidecar, where the model cannot
//! bypass it: a **rate limit** + a **per-N re-confirm**. The server runs TWO independent gates:
//!   - **actuation** — only `computer_act` (injects input);
//!   - **egress** — every screenshot that leaves the machine to the vision model (`computer_act` AND
//!     `computer_observe`), so a model can't loop `computer_observe` to exfiltrate the screen.
//!
//! Pure + deterministic: time is injected (`now_ms`, monotonic), so it is fully unit-tested.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateDecision {
    /// Operation permitted; the gate has recorded it.
    Allow,
    /// A human re-confirmation is required before continuing (per-N reached). The caller must surface
    /// it and call `confirm()` on approval; the operation is NOT recorded until re-attempted.
    NeedsReconfirm,
    /// Hard rate limit hit for the current window; reject until the window rolls over.
    RateLimited,
}

/// One gate (actuation or egress). `reconfirm_every == 0` disables the re-confirm requirement;
/// `max_per_window == 0` disables the rate limit.
#[derive(Debug, Clone)]
pub struct ActionGate {
    reconfirm_every: u32,
    max_per_window: u32,
    window_ms: u64,
    // state
    count_since_reconfirm: u32,
    window_start_ms: u64,
    window_count: u32,
    started: bool,
}

impl ActionGate {
    pub fn new(reconfirm_every: u32, max_per_window: u32, window_ms: u64) -> Self {
        Self {
            reconfirm_every,
            max_per_window,
            window_ms,
            count_since_reconfirm: 0,
            window_start_ms: 0,
            window_count: 0,
            started: false,
        }
    }

    /// Ask permission for one operation at monotonic time `now_ms`. On `Allow` the op is recorded;
    /// `NeedsReconfirm` / `RateLimited` record nothing (the caller did not act).
    pub fn check(&mut self, now_ms: u64) -> GateDecision {
        // Roll the rate-limit window.
        if self.max_per_window > 0 {
            if !self.started || now_ms.saturating_sub(self.window_start_ms) >= self.window_ms {
                self.window_start_ms = now_ms;
                self.window_count = 0;
                self.started = true;
            }
            if self.window_count >= self.max_per_window {
                return GateDecision::RateLimited;
            }
        }
        // Per-N re-confirm: after `reconfirm_every` allowed ops, the next needs a human.
        if self.reconfirm_every > 0 && self.count_since_reconfirm >= self.reconfirm_every {
            return GateDecision::NeedsReconfirm;
        }
        self.count_since_reconfirm += 1;
        self.window_count += 1;
        GateDecision::Allow
    }

    /// A human re-confirmed — clear the per-N counter so the next `reconfirm_every` ops flow.
    /// Does NOT reset the rate-limit window (a re-confirm is not a rate-limit bypass).
    pub fn confirm(&mut self) {
        self.count_since_reconfirm = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn per_n_reconfirm_blocks_after_n_then_confirm_resumes() {
        let mut g = ActionGate::new(3, 0, 0); // reconfirm every 3, no rate limit
        assert_eq!(g.check(0), GateDecision::Allow);
        assert_eq!(g.check(0), GateDecision::Allow);
        assert_eq!(g.check(0), GateDecision::Allow);
        // 4th needs reconfirm, and stays blocked until confirmed (not recorded meanwhile)
        assert_eq!(g.check(0), GateDecision::NeedsReconfirm);
        assert_eq!(g.check(0), GateDecision::NeedsReconfirm);
        g.confirm();
        assert_eq!(g.check(0), GateDecision::Allow); // 4th
        assert_eq!(g.check(0), GateDecision::Allow); // 5th
        assert_eq!(g.check(0), GateDecision::Allow); // 6th
        assert_eq!(g.check(0), GateDecision::NeedsReconfirm); // 7th
    }

    #[test]
    fn rate_limit_caps_per_window_then_rolls_over() {
        let mut g = ActionGate::new(0, 2, 1000); // max 2 per 1s, no reconfirm
        assert_eq!(g.check(0), GateDecision::Allow);
        assert_eq!(g.check(100), GateDecision::Allow);
        assert_eq!(g.check(200), GateDecision::RateLimited);
        assert_eq!(g.check(999), GateDecision::RateLimited);
        // window rolls at >= 1000ms from window start
        assert_eq!(g.check(1000), GateDecision::Allow);
        assert_eq!(g.check(1100), GateDecision::Allow);
        assert_eq!(g.check(1200), GateDecision::RateLimited);
    }

    #[test]
    fn rate_limit_takes_precedence_over_reconfirm() {
        let mut g = ActionGate::new(5, 1, 1000); // reconfirm@5 but only 1 per window
        assert_eq!(g.check(0), GateDecision::Allow);
        assert_eq!(g.check(10), GateDecision::RateLimited); // rate limit fires before reconfirm
    }

    #[test]
    fn confirm_does_not_reset_the_rate_limit_window() {
        let mut g = ActionGate::new(1, 1, 1000);
        assert_eq!(g.check(0), GateDecision::Allow);
        assert_eq!(g.check(10), GateDecision::RateLimited);
        g.confirm(); // clears reconfirm, but rate limit still holds the window
        assert_eq!(g.check(20), GateDecision::RateLimited);
    }

    #[test]
    fn disabled_gates_always_allow() {
        let mut g = ActionGate::new(0, 0, 0);
        for t in 0..100 {
            assert_eq!(g.check(t), GateDecision::Allow);
        }
    }
}

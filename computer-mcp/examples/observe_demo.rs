//! Observe-only computer-use proof — the de-scoped MVP (docs/computer-use-design.md). Capture THIS
//! machine's primary display → a vision model DESCRIBES what's on screen → print the text. No
//! grounding, no coordinates, no input injection: the agent SEES the screen, it does NOT act on it.
//!
//! The coding session model isn't vision-capable, so "see the screen" = capture → vision model →
//! TEXT returned to the agent (the same delegation seam as generate_image). Privacy: this sends your
//! screen to a model — run only with consent:
//!   cargo run --example observe_demo -- <ark_key_file> ["<question>"]

use std::time::Duration;

use base64::Engine;
use computer_mcp::capture;

const ARK_URL: &str = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const MODEL: &str = "doubao-seed-1-6-flash-250828";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let key_file = args.next().ok_or("usage: observe_demo <ark_key_file> [question]")?;
    let question = args.next().unwrap_or_else(|| {
        "Describe what is on this screen: which apps/windows are open, any visible text or errors, \
         and the overall layout. Be concise and concrete."
            .to_string()
    });
    let key = std::fs::read_to_string(&key_file)?.trim().to_string();

    // Capture the primary display (physical px) → PNG → base64.
    let (rgba, w, h) = capture::capture_primary()?;
    let img: image::RgbaImage =
        image::ImageBuffer::from_raw(w, h, rgba).ok_or("ImageBuffer::from_raw failed")?;
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    println!(
        "captured {w}x{h} physical px ({} KB) → asking the vision model…\n",
        png.len() / 1024
    );

    // Ask the vision model to describe the screen. No tools, no coordinates — just text back.
    let body = serde_json::json!({
        "model": MODEL,
        "temperature": 0,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": question},
                {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{b64}")}}
            ]
        }]
    });
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(120)))
        .build()
        .into();
    let mut resp = agent
        .post(ARK_URL)
        .header("Authorization", &format!("Bearer {key}"))
        .send_json(&body)?;
    let v: serde_json::Value = resp.body_mut().read_json()?;
    let text = v["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("no content in response")?;
    println!("=== the agent would receive this text ===\n{text}");
    Ok(())
}

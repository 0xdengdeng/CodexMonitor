//! Behavioral verification of computer-use grounding (docs/computer-use-design.md). Capture → ground
//! a target → CLICK it → capture the result (proof PNG) → press Escape. For the Apple logo, a correct
//! click opens the Apple menu — a deterministic effect nothing else produces, so the proof screenshot
//! showing the open menu objectively confirms the click landed. DESTRUCTIVE; run only with consent:
//!   cargo run --example click_verify -- <ark_key_file> "<target>" <proof_png_path>

use std::time::Duration;

use base64::Engine;
use computer_mcp::coords::{denormalize, physical_to_logical, CoordConvention, ScreenshotDims};
use computer_mcp::{capture, inject};

const ARK_URL: &str = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const MODEL: &str = "doubao-seed-1-6-flash-250828";

fn ground(key: &str, target: &str, w: u32, h: u32, b64: &str) -> Result<(f64, f64), Box<dyn std::error::Error>> {
    let body = serde_json::json!({
        "model": MODEL, "temperature": 0, "tool_choice": "required",
        "tools": [{"type":"function","function":{"name":"click",
            "description":"Click at a pixel coordinate on the screenshot.",
            "parameters":{"type":"object","properties":{
                "x":{"type":"integer"},"y":{"type":"integer"}},"required":["x","y"]}}}],
        "messages": [
            {"role":"system","content": format!("You control a {w}x{h} screen. Call click(x,y) with absolute pixel coordinates.")},
            {"role":"user","content":[
                {"type":"text","text": format!("Click {target}.")},
                {"type":"image_url","image_url":{"url": format!("data:image/png;base64,{b64}")}}]}]
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
    let args_str = v["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]
        .as_str()
        .ok_or("no tool_calls in response")?;
    let click: serde_json::Value = serde_json::from_str(args_str)?;
    Ok((
        click["x"].as_f64().ok_or("no x")?,
        click["y"].as_f64().ok_or("no y")?,
    ))
}

fn capture_png(path: &str) -> Result<(u32, u32, String), Box<dyn std::error::Error>> {
    let (rgba, w, h) = capture::capture_primary()?;
    let img: image::RgbaImage =
        image::ImageBuffer::from_raw(w, h, rgba).ok_or("from_raw failed")?;
    img.save(path)?;
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
    Ok((w, h, base64::engine::general_purpose::STANDARD.encode(&png)))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let key_file = args.next().ok_or("usage: click_verify <key> <target> <proof_png>")?;
    let target = args
        .next()
        .unwrap_or_else(|| "the Apple logo at the very top-left corner of the menu bar".to_string());
    let proof = args.next().unwrap_or_else(|| "/tmp/cu_before.png".to_string());
    let key = std::fs::read_to_string(&key_file)?.trim().to_string();

    // Capture (pre-click) + ground.
    let (w, h, b64) = capture_png("/tmp/cu_before.png")?;
    let (mx, my) = ground(&key, &target, w, h, &b64)?;
    let dims = ScreenshotDims { width: w, height: h };
    let (px, py) = denormalize(mx, my, CoordConvention::Normalized1000, dims);
    let (lw, _) = inject::logical_main_display()?;
    let scale = w as f64 / lw as f64;
    let (lx, ly) = physical_to_logical(px, py, scale);
    println!("grounded /1000=({mx},{my}) → physical=({px},{py}) → logical=({lx},{ly})");

    // CLICK, let the menu render, capture the proof, then dismiss with Escape.
    inject::click_left_at_logical(lx, ly)?;
    std::thread::sleep(Duration::from_millis(700));
    let (r, pw, ph) = capture::capture_primary()?;
    let img: image::RgbaImage = image::ImageBuffer::from_raw(pw, ph, r).ok_or("from_raw")?;
    img.save(&proof)?;
    inject::press_escape()?;
    println!("clicked → captured proof {proof} ({pw}x{ph}) → pressed Escape to dismiss");
    Ok(())
}

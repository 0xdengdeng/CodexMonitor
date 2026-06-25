//! End-to-end computer-use demo (docs/computer-use-design.md): capture THIS machine's screen → a
//! CUA vision model grounds a target → denormalize → physical→logical → move the cursor there.
//! DESTRUCTIVE (moves the real cursor; captures the real screen + sends it to the model). Run only
//! with consent:
//!   cargo run --example act_demo -- <ark_key_file> "<target description>"
//! Grounds via Ark-direct (doubao-seed-1-6-flash-250828, /1000). Moves — does NOT click.

use std::time::Duration;

use base64::Engine;
use computer_mcp::coords::{denormalize, physical_to_logical, CoordConvention, ScreenshotDims};
use computer_mcp::{capture, inject};

const ARK_URL: &str = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const MODEL: &str = "doubao-seed-1-6-flash-250828";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let key_file = args.next().ok_or("usage: act_demo <ark_key_file> <target>")?;
    let target = args
        .next()
        .unwrap_or_else(|| "the Apple logo at the very top-left corner of the menu bar".to_string());
    let key = std::fs::read_to_string(&key_file)?.trim().to_string();

    // 1. Capture (physical px).
    let (rgba, w, h) = capture::capture_primary()?;
    println!("captured {w}x{h} physical px");

    // 2. RGBA → PNG → base64.
    let img: image::RgbaImage =
        image::ImageBuffer::from_raw(w, h, rgba).ok_or("ImageBuffer::from_raw failed")?;
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    println!("encoded PNG: {} KB", png.len() / 1024);

    // 3. Ground via the vision model (a `click(x,y)` function tool; /1000 normalized output).
    let body = serde_json::json!({
        "model": MODEL,
        "temperature": 0,
        "tool_choice": "required",
        "tools": [{"type":"function","function":{
            "name":"click","description":"Click at a pixel coordinate on the screenshot.",
            "parameters":{"type":"object","properties":{
                "x":{"type":"integer","description":"x, 0=left"},
                "y":{"type":"integer","description":"y, 0=top"}},"required":["x","y"]}}}],
        "messages": [
            {"role":"system","content": format!("You control a {w}x{h} screen. Call click(x,y) with absolute pixel coordinates.")},
            {"role":"user","content":[
                {"type":"text","text": format!("Click {target}.")},
                {"type":"image_url","image_url":{"url": format!("data:image/png;base64,{b64}")}}]}]
    });
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(120)))
        .build()
        .into();
    let mut resp = ureq::Agent::new_with_config(agent)
        .post(ARK_URL)
        .header("Authorization", &format!("Bearer {key}"))
        .send_json(&body)?;
    let v: serde_json::Value = resp.body_mut().read_json()?;
    let tc = &v["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"];
    let args_str = tc.as_str().ok_or("no tool_calls in response")?;
    let click: serde_json::Value = serde_json::from_str(args_str)?;
    let (mx, my) = (
        click["x"].as_f64().ok_or("no x")?,
        click["y"].as_f64().ok_or("no y")?,
    );
    println!("model grounded (/1000): ({mx}, {my})");

    // 4. /1000 → physical px → logical px (for enigo).
    let dims = ScreenshotDims { width: w, height: h };
    let (px, py) = denormalize(mx, my, CoordConvention::Normalized1000, dims);
    let (lw, _) = inject::logical_main_display()?;
    let scale = w as f64 / lw as f64;
    let (lx, ly) = physical_to_logical(px, py, scale);
    println!("physical=({px},{py})  scale={scale}  logical=({lx},{ly})");

    // 5. Move the cursor (NOT click).
    let before = inject::cursor_location()?;
    inject::move_cursor_logical(lx, ly)?;
    let after = inject::cursor_location()?;
    println!("cursor moved: {before:?} -> {after:?}  (target: {target})");
    Ok(())
}

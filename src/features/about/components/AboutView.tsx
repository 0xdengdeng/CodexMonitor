import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PRODUCT_NAME } from "@/config/brand";

export function AboutView() {
  const [version, setVersion] = useState<string | null>(null);

  const handleOpenProject = () => {
    void openUrl("https://github.com/0xdengdeng/CodexMonitor");
  };

  useEffect(() => {
    let active = true;
    const fetchVersion = async () => {
      try {
        const value = await getVersion();
        if (active) {
          setVersion(value);
        }
      } catch {
        if (active) {
          setVersion(null);
        }
      }
    };

    void fetchVersion();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="about">
      <div className="about-card">
        <div className="about-header">
          <img
            className="about-icon"
            src="/app-icon.png"
            alt={`${PRODUCT_NAME} icon`}
          />
          <div className="about-title">{PRODUCT_NAME}</div>
        </div>
        <div className="about-version">
          {version ? `Version ${version}` : "Version —"}
        </div>
        <div className="about-tagline">
          企业内部的 AI 开发工具入口
        </div>
        <div className="about-divider" />
        <div className="about-links">
          <button
            type="button"
            className="about-link"
            onClick={handleOpenProject}
          >
            Project
          </button>
        </div>
        <div className="about-footer">Powered by Codex</div>
      </div>
    </div>
  );
}

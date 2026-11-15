// ccpreview:// 协议后端测试：URL↔路径互转、目录白名单、顶层文档 shim 注入、
// 白名单上限淘汰。Response 用 Node 全局（undici），纯 node 环境可跑。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  clearPreviewRoots,
  handlePreviewRequest,
  mimeFor,
  parsePreviewUrl,
  previewRootsSnapshot,
  registerPreviewRoots,
  toPreviewUrl,
} from "./preview-protocol";

let tmp: string;
let docDir: string;
let doc: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-fast-test-ccpreview-"));
  docDir = path.join(tmp, "plans");
  fs.mkdirSync(docDir);
  doc = path.join(docDir, "page.html");
  fs.writeFileSync(doc, "<html><head><title>t</title></head><body>b</body></html>");
  fs.writeFileSync(path.join(docDir, "style.css"), "body{color:red}");
  fs.writeFileSync(path.join(tmp, "secret.txt"), "top secret");
  clearPreviewRoots();
});

afterEach(() => {
  clearPreviewRoots();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("parsePreviewUrl / toPreviewUrl", () => {
  it("Windows 路径往返（含 CJK 与空格段）", () => {
    const p = "D:\\工作区\\my plans\\页 面.html";
    expect(parsePreviewUrl(toPreviewUrl(p))).toBe(path.normalize(p));
  });

  it("POSIX 路径往返（leading / 折叠还原）", () => {
    const p = "/home/u/reports/x.md";
    expect(parsePreviewUrl(toPreviewUrl(p))).toBe(path.normalize(p));
  });

  it("拒绝非本协议 / 空 host / 空 pathname", () => {
    expect(parsePreviewUrl("https://p/x")).toBeNull();
    expect(parsePreviewUrl("ccpreview://other/x")).toBeNull();
    expect(parsePreviewUrl("ccpreview://p/")).toBeNull();
    expect(parsePreviewUrl("not a url")).toBeNull();
  });

  it(".. 段经 normalize 折出白名单外的真实路径（handler 侧 403 挡）", () => {
    // path 层面只负责还原：ccpreview://p/D:/proj/../secret.txt → D:\secret.txt
    expect(parsePreviewUrl(toPreviewUrl("D:\\proj\\..\\secret.txt"))).toBe(
      path.normalize("D:\\secret.txt"),
    );
  });

  it("UNC 路径以哨兵段往返（前导 // 不被 URL 折叠）", () => {
    const p = "\\\\nas\\share\\proj\\x.html";
    expect(parsePreviewUrl(toPreviewUrl(p))).toBe(path.normalize(p));
    expect(toPreviewUrl(p)).toContain("__ccunc__");
  });
});

describe("mimeFor", () => {
  it("text 系带 charset，未知类型 octet-stream", () => {
    expect(mimeFor(".css")).toBe("text/css; charset=utf-8");
    expect(mimeFor(".HTML")).toBe("text/html; charset=utf-8");
    expect(mimeFor(".woff2")).toBe("font/woff2");
    expect(mimeFor(".weird")).toBe("application/octet-stream");
  });
});

describe("handlePreviewRequest", () => {
  it("白名单内文件 200 + 原文 + 正确 Content-Type + CORS 头", async () => {
    registerPreviewRoots(doc, [docDir]);
    const res = await handlePreviewRequest(toPreviewUrl(path.join(docDir, "style.css")));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("body{color:red}");
    expect(res.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("顶层 html 注入 storage shim，子资源不注入", async () => {
    registerPreviewRoots(doc, [docDir]);
    const top = await handlePreviewRequest(toPreviewUrl(doc));
    expect(await top.text()).toContain("__ccprobe__");
    const sub = await handlePreviewRequest(toPreviewUrl(path.join(docDir, "style.css")));
    expect(await sub.text()).not.toContain("__ccprobe__");
  });

  it(".htm 顶层文档同样注入 shim", async () => {
    const htm = path.join(docDir, "page.htm");
    fs.writeFileSync(htm, "<html><head></head><body></body></html>");
    registerPreviewRoots(htm, [docDir]);
    const res = await handlePreviewRequest(toPreviewUrl(htm));
    expect(await res.text()).toContain("__ccprobe__");
  });

  it("畸形 percent 序列（%ZZ）不抛——统一 400", async () => {
    registerPreviewRoots(doc, [docDir]);
    const res = await handlePreviewRequest("ccpreview://p/D%3A/%ZZ/x.md");
    expect(res.status).toBe(400);
  });

  it("白名单外 403；白名单内不存在 404；目录 403", async () => {
    registerPreviewRoots(doc, [docDir]);
    const outside = await handlePreviewRequest(toPreviewUrl(path.join(tmp, "secret.txt")));
    expect(outside.status).toBe(403);
    const missing = await handlePreviewRequest(toPreviewUrl(path.join(docDir, "nope.css")));
    expect(missing.status).toBe(404);
    const dirReq = await handlePreviewRequest(toPreviewUrl(docDir));
    expect(dirReq.status).toBe(403);
  });

  it(".. 穿越被白名单拦住（403）", async () => {
    registerPreviewRoots(doc, [docDir]);
    const res = await handlePreviewRequest(toPreviewUrl(path.join(docDir, "..", "secret.txt")));
    expect(res.status).toBe(403);
  });

  it("项目根整树可读（根 = 父目录，子目录文件命中）", async () => {
    const shared = path.join(tmp, "shared");
    fs.mkdirSync(shared);
    fs.writeFileSync(path.join(shared, "logo.svg"), "<svg/>");
    // 项目根 = tmp：doc 在 tmp/plans，shared 是兄弟目录——「项目根」白名单覆盖它
    registerPreviewRoots(doc, [docDir, tmp]);
    const res = await handlePreviewRequest(toPreviewUrl(path.join(shared, "logo.svg")));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<svg/>");
  });

  it("白名单上限 16：最早登记的被淘汰", async () => {
    for (let i = 0; i < 17; i++) {
      const dirI = path.join(tmp, "r" + i);
      fs.mkdirSync(dirI);
      fs.writeFileSync(path.join(dirI, "a.txt"), String(i));
      registerPreviewRoots(path.join(dirI, "a.txt"), [dirI]);
    }
    const snapshot = previewRootsSnapshot();
    expect(snapshot.length).toBe(16);
    const firstGone = await handlePreviewRequest(toPreviewUrl(path.join(tmp, "r0", "a.txt")));
    expect(firstGone.status).toBe(403);
    const lastAlive = await handlePreviewRequest(toPreviewUrl(path.join(tmp, "r16", "a.txt")));
    expect(lastAlive.status).toBe(200);
  });

  it("上限按根计：符号链接根（双 key）只占一个名额（无链接特权时跳过）", async () => {
    const realDir = path.join(tmp, "cap-real");
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, "f.txt"), "cap");
    let made = false;
    try {
      fs.symlinkSync(realDir, path.join(tmp, "cap-link"), "dir");
      made = true;
    } catch {
      /* 无符号链接特权时无从测起 */
    }
    if (!made) return;
    const linkRoot = path.join(tmp, "cap-link");
    for (let i = 0; i < 15; i++) {
      const d = path.join(tmp, "c" + i);
      fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, "a.txt"), String(i));
      registerPreviewRoots(path.join(d, "a.txt"), [d]);
    }
    // 双 key 的链接根 + 15 个单 key 根 = 16 根满
    registerPreviewRoots(path.join(linkRoot, "f.txt"), [linkRoot]);
    expect(previewRootsSnapshot().length).toBe(16);
    // 再进一个新根 → 最老整根淘汰、链接根仍存活（双 key 不多占名额）
    const dNew = path.join(tmp, "c99");
    fs.mkdirSync(dNew);
    registerPreviewRoots(path.join(dNew, "a.txt"), [dNew]);
    expect(previewRootsSnapshot().length).toBe(16);
    const evicted = await handlePreviewRequest(toPreviewUrl(path.join(tmp, "c0", "a.txt")));
    expect(evicted.status).toBe(403);
    const linkAlive = await handlePreviewRequest(toPreviewUrl(path.join(linkRoot, "f.txt")));
    expect(linkAlive.status).toBe(200);
  });

  it("符号链接：指向白名单外拒绝（创建失败的平台跳过）", async () => {
    const inside = path.join(docDir, "link.txt");
    let created = false;
    try {
      fs.symlinkSync(path.join(tmp, "secret.txt"), inside, "file");
      created = true;
    } catch {
      // Windows 无开发者模式/特权时创建符号链接会失败：该用例无从测起，跳过
    }
    if (!created) return;
    registerPreviewRoots(doc, [docDir]);
    const res = await handlePreviewRequest(toPreviewUrl(inside));
    expect(res.status).toBe(403);
  });

  it("根目录本身是符号链接：登记形态含 realpath，整树仍可读（创建失败的平台跳过）", async () => {
    const realDir = path.join(tmp, "real-root");
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, "f.txt"), "in real");
    let created = false;
    try {
      fs.symlinkSync(realDir, path.join(tmp, "link-root"), "dir");
      created = true;
    } catch {
      // 同上：无符号链接特权时无从测起
    }
    if (!created) return;
    const linkRoot = path.join(tmp, "link-root");
    const docInLink = path.join(linkRoot, "f.txt");
    registerPreviewRoots(docInLink, [linkRoot]);
    const res = await handlePreviewRequest(toPreviewUrl(docInLink));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("in real");
  });
});

/**
 * 会话内搜索的关键词高亮：把消息正文（markdown → HTML）里命中的关键词包成 <mark>，
 * 让「点击搜索结果 → 跳转」后能直接看到词，而不是只靠整条消息闪一下。
 *
 * 与既有的 list-markers / code-copy 同一条「消毒之后、DOM walk」后处理链：
 * 对 HTML 字符串做正则替换会撞进标签/属性，DOM 层面拆文本节点才安全。
 *
 * ⚠️ 关键词归一口径必须与后端 normalizeKeyword（electron/backend/session-extra.ts）
 * 逐字同步：trim + 连续空白折叠单空格 + lowercase。主进程不引渲染层模块，两边
 * 各写一份，改要同步。
 */
import { createElement, type ReactNode } from "react";

/** 关键词归一：trim + 连续空白折叠单空格 + lowercase */
export function normalizeKeyword(keyword: string): string {
  return keyword.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 单段文本里的命中区间（码元下标，左闭右开），按出现顺序、不重叠；无命中返回空数组。
 *  大小写不敏感的字面子串匹配，与后端 indexOf 语义一致 */
export function keywordRanges(text: string, kw: string): Array<[number, number]> {
  if (kw === "") return [];
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const hit = lower.indexOf(kw, from);
    if (hit === -1) break;
    ranges.push([hit, hit + kw.length]);
    from = hit + kw.length;
  }
  return ranges;
}

/**
 * 给消毒后的 HTML 加关键词高亮：walk 文本节点，命中的子串拆进 <mark>。
 * 无关键词、或整段 HTML 里找不到时原样返回（快速门，免付 DOMParser 开销）。
 *
 * 有意只做**单个文本节点内**的匹配，不跨节点拼词：markdown 会把 `**foo** bar`
 * 切成多个文本节点，跨节点拼接可能拼出原文里不存在的连续串（后端 haystack 是
 * 未折叠的原文，跨节点拼词与之口径不符）。漏高亮的代价只是不醒目，定位仍可用。
 * mark 内不再嵌套（重复调用时避免套娃）。
 */
/** 纯文本关键词高亮（ReactNode 版）：用户气泡、工具 JSON/diff 行、搜索结果片段等
 *  纯文本处用；大小写不敏感的字面子串切分，不用正则（关键词含元字符也安全） */
export function highlightKeyword(text: string, kw: string | undefined): ReactNode {
  const k = normalizeKeyword(kw ?? "");
  if (k === "") return text;
  const ranges = keywordRanges(text, k);
  if (ranges.length === 0) return text;
  const parts: ReactNode[] = [];
  let pos = 0;
  let key = 0;
  for (const [start, end] of ranges) {
    if (start > pos) parts.push(text.slice(pos, start));
    parts.push(createElement("mark", { key: key++ }, text.slice(start, end)));
    pos = end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
}

export function highlightTextHtml(html: string, keyword: string): string {
  const kw = normalizeKeyword(keyword);
  if (kw === "") return html;
  if (typeof DOMParser === "undefined") return html; // 非渲染环境（node 单测）
  if (!html.toLowerCase().includes(kw)) return html;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return html; // text/html 解析按规格不抛；防御性兜底
  }
  const body = doc.body;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "MARK") {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  // TreeWalker 与现场改动互斥，先收集再逐个替换
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.nodeValue ?? "";
    const ranges = keywordRanges(text, kw);
    if (ranges.length === 0) continue;
    const frag = doc.createDocumentFragment();
    let pos = 0;
    for (const [start, end] of ranges) {
      if (start > pos) frag.appendChild(doc.createTextNode(text.slice(pos, start)));
      const mark = doc.createElement("mark");
      mark.textContent = text.slice(start, end);
      frag.appendChild(mark);
      pos = end;
    }
    if (pos < text.length) frag.appendChild(doc.createTextNode(text.slice(pos)));
    node.parentNode?.replaceChild(frag, node);
  }
  return body.innerHTML;
}

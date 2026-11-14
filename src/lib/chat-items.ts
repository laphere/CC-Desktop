import type { ChatItem } from "../types";

/**
 * 把流已越过、却始终没等到收口帧的 thinking 条目就地定稿：按 startedAt 冻结实测
 * 时长、streaming 翻 false。调用时机 = 「这个块的内容块停止帧（content_block_stop →
 * thinking_done）永远不会再来的时刻」：任何新的内容块开流（thinking/text/tool 的
 * content_start、tool_use_start——块按序开合，下一块开工即上一块已闭）、以及
 * api_retry（在途请求已死，它的开块随之作废）。已定稿的（durationMs 已落）不动，
 * thinking_done 只写时长不翻 streaming 是正常路径，不是这里的对象。
 *
 * 不定稿的代价：条目上的活秒表（now − startedAt）一路走到轮末，组摘要把多个相互
 * 重叠的僵尸秒表逐个加总，总时长轻松超过整轮墙钟时间（2026-11-15 用户实测：真实
 * 思考 31 分钟的一轮，摘要显示「354 分」）。
 *
 * 正常流里 thinking 块收口先于任何下一块开工，命中的全是断流/重试留下的残块，
 * 不会伤到正在流式的当前块。与收轮用的 settleStreamingItems（ChatView）分工：
 * 那份只翻 streaming 不定格时长（轮末对「没数据的思考不显示时长」的既有约定），
 * 这份手里的 startedAt 是真实测过的窗口，冻结下来让合计保持诚实。
 *
 * now 由调用方传入（事件到达时刻取一次），updater 保持纯函数——StrictMode 下
 * updater 会双调，内部取时钟会拿到两个不同的冻结值（项目既有约定，见 App.tsx
 * openChatTab 的注释）。
 */
export function settleStaleThinking(prev: ChatItem[], now: number): ChatItem[] {
  let touched = false;
  const next = prev.map((it) => {
    if (it.kind !== "thinking" || !it.streaming || it.durationMs != null) return it;
    touched = true;
    return it.startedAt != null
      ? { ...it, streaming: false, durationMs: Math.max(0, now - it.startedAt) }
      : { ...it, streaming: false };
  });
  return touched ? next : prev;
}

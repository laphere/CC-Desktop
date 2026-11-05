import { beforeAll, describe, expect, it } from "vitest";
import { marked } from "marked";
import { installMarkdownExtensions } from "./highlight";

// 全局 marked 单例：装一次即可（vitest 每个测试文件独立进程，不污染其他测试）
beforeAll(() => installMarkdownExtensions());

const parse = (md: string) => (marked.parse(md, { async: false }) as string).trim();

describe("marked 扩展：删除线定界符只认 ~~", () => {
  it("单波浪号的区间/约数原样保留", () => {
    const html = parse(
      "这张 monitor 图不支持“后端迁移把接口拖慢，导致自愈重启/窗口数增长”这个假设。" +
        "接口平均 7~10ms、最大 3~5 秒，离客户端的 10 分钟心跳、90 秒启动、15 秒关窗清理都差得远。",
    );
    expect(html).not.toContain("<del>");
    expect(html).toContain("7~10ms");
    expect(html).toContain("3~5 秒");
  });

  it("同一段里的三个单波浪号（两个区间 + 百分比）都不配对", () => {
    const html = parse("A/B 两台几乎一致，平均 7~10ms、最大 3~5 秒、错误率 0.1%~2.5%——说明：");
    expect(html).not.toContain("<del>");
    expect(html).toContain("0.1%~2.5%");
  });

  it("QPS 区间与百分比区间同样保留", () => {
    const html = parse("Redis 读 ops ~1000~4000 ops/s，空请求压到 27~80 QPS，10~30% 窗口空手");
    expect(html).not.toContain("<del>");
    expect(html).toContain("1000~4000");
    expect(html).toContain("27~80");
    expect(html).toContain("10~30%");
  });

  it("表格单元格里的区间不被划掉", () => {
    const html = parse("| 项 | 结果 |\n|---|---|\n| 延迟 | 7~10ms、最大 3~5 秒 |");
    expect(html).not.toContain("<del>");
    expect(html).toContain("7~10ms");
    expect(html).toContain("3~5 秒");
  });

  it("双波浪号删除线照常生效", () => {
    expect(parse("~~删掉这句~~")).toContain("<del>删掉这句</del>");
  });

  it("同一段里混用：只把 ~~ 当定界符", () => {
    const html = parse("A ~~B~~ C ~D~ E");
    expect(html).toContain("<del>B</del>");
    expect(html).toContain("~D~");
    expect((html.match(/<del>/g) ?? []).length).toBe(1);
  });

  it("行内代码与围栏代码块里的波浪号不受影响", () => {
    expect(parse("`7~10ms`")).toContain("<code>7~10ms</code>");
    const block = parse("```\n7~10ms\n3~5 秒\n```");
    expect(block).not.toContain("<del>");
    expect(block).toContain("7~10ms");
    expect(block).toContain("3~5 秒");
  });

  it("双波浪号删除线上等价于内置实现：掩蔽、嵌套平衡、标点 flanking", () => {
    // 行内代码/链接目标/HTML 属性里的 `~~` 不参与配对
    expect(parse("~~把 `~~x` 这种双取反写法删掉~~")).toBe(
      "<p><del>把 <code>~~x</code> 这种双取反写法删掉</del></p>",
    );
    expect(parse("~~see [x](https://e.com/~~a~~) end~~")).toBe(
      '<p><del>see <a href="https://e.com/~~a~~">x</a> end</del></p>',
    );
    expect(parse('~~a <b title="~~">c</b> d~~')).toBe('<p><del>a <b title="~~">c</b> d</del></p>');
    // 嵌套配对与未闭合
    expect(parse("~~a ~~b~~ c~~")).toBe("<p><del>a <del>b</del> c</del></p>");
    expect(parse("~~未闭合")).toBe("<p>~~未闭合</p>");
    // 标点 flanking：开标记前/闭标记后的标点让它们保持字面
    expect(parse("a~~.b~~")).toBe("<p>a~~.b~~</p>");
    expect(parse("~~！~~b")).toBe("<p>~~！~~b</p>");
  });
});

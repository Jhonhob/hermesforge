import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StreamingMarkdown } from "./StreamingMarkdown";

describe("StreamingMarkdown", () => {
  it("wraps markdown tables in a scroll container without inheriting aggressive wrapping", () => {
    render(
      <StreamingMarkdown
        content={[
          "| 状态 | 页面 | 路径 | 说明 |",
          "| --- | --- | --- | --- |",
          "| ✅ | 首页 | pages/index/index | 7屏入口 |",
          "| ✅ | 五金牛详情 | pages/wujin/detail | 100+商品，路径较长 |",
        ].join("\n")}
        className="hermes-markdown [overflow-wrap:anywhere]"
      />,
    );

    const table = screen.getByRole("table");
    expect(table.parentElement).toHaveClass("overflow-x-auto");
    expect(table).toHaveClass("[overflow-wrap:normal]");
    expect(screen.getByRole("columnheader", { name: "路径" })).toHaveClass("whitespace-nowrap");
    expect(screen.getByRole("cell", { name: "pages/index/index" })).toHaveClass("[overflow-wrap:break-word]");
  });
});

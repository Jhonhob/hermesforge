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

  it("repairs space-aligned CLI tables before rendering markdown", () => {
    render(
      <StreamingMarkdown
        content={[
          "从 hermes plugins list 可以看到已安装的平台插件：",
          "",
          "平台插件名    状态",
          "Google Chat   platforms/google_chat   ✅ 已安装",
          "IRC           platforms/irc           ✅ 已安装",
          "LINE          platforms/line          ✅ 已安装",
          "SimpleX       platforms/simplex       ✅ 已安装",
          "MicrosoftTeams     platforms/teams       ✅ 已安装",
          "❌ 微信（WeChat） - ❌ 飞书（Feishu/Lark）",
        ].join("\n")}
        className="hermes-markdown [overflow-wrap:anywhere]"
      />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "平台插件名" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "路径" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "状态" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Google Chat" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "platforms/google_chat" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "✅ 已安装" })).toHaveLength(5);
  });
});

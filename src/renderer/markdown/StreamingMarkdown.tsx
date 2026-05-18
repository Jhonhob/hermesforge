import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

type Block = { content: string; code: boolean };

export function StreamingMarkdown(props: { content: string; isStreaming?: boolean; className?: string; onFileClick?: (path: string) => void }) {
  const deferredContent = React.useDeferredValue(props.content);
  const content = props.isStreaming ? compactStreamingMarkdown(deferredContent) : props.content;
  const blocks = React.useMemo(() => splitIntoBlocks(content), [content]);
  return (
    <div className={props.className}>
      {blocks.map((block, index) => {
        const active = props.isStreaming && index === blocks.length - 1;
        const key = active ? `active-${index}` : `block-${hashBlock(block.content)}`;
        return <MemoizedMarkdownBlock key={key} content={block.content} onFileClick={props.onFileClick} />;
      })}
    </div>
  );
}

const STREAMING_MARKDOWN_PREVIEW_CHARS = 48_000;
const STREAMING_MARKDOWN_TAIL_CHARS = 20_000;

function compactStreamingMarkdown(content: string) {
  if (content.length <= STREAMING_MARKDOWN_PREVIEW_CHARS) return content;
  const tail = content.slice(-STREAMING_MARKDOWN_TAIL_CHARS);
  const lineBreak = tail.indexOf("\n");
  const trimmedTail = lineBreak > 0 ? tail.slice(lineBreak + 1) : tail;
  return `> 正在生成长回复，已临时折叠前文以保持输入流畅。完成后会显示完整内容。\n\n${trimmedTail}`;
}

const MemoizedMarkdownBlock = React.memo(function MarkdownBlock(props: { content: string; onFileClick?: (path: string) => void }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, rehypeSanitize]}
      components={{
        code({ className, children }) {
          const match = /language-(\w+)/.exec(className ?? "");
          const content = String(children).replace(/\n$/, "");
          if (match) return <CodeBlock code={content} language={match[1]} />;
          return <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-800">{children}</code>;
        },
        hr() {
          return <hr className="my-4 border-slate-200/80" />;
        },
        blockquote({ children }) {
          return <blockquote className="my-3 border-l-4 border-[var(--hermes-primary-border)] bg-white/55 py-2 pl-3 pr-4 text-slate-600">{children}</blockquote>;
        },
        table({ children }) {
          return (
            <div className="my-4 overflow-x-auto rounded-xl border border-slate-200/80 bg-white/70 shadow-sm">
              <table className="min-w-full table-auto border-collapse text-left text-[13px] leading-5 [overflow-wrap:normal]">
                {children}
              </table>
            </div>
          );
        },
        thead({ children }) {
          return <thead className="bg-slate-50/90 text-slate-700">{children}</thead>;
        },
        tbody({ children }) {
          return <tbody className="divide-y divide-slate-200/70">{children}</tbody>;
        },
        th({ children }) {
          return <th className="whitespace-nowrap px-3 py-2 font-semibold text-slate-700">{children}</th>;
        },
        td({ children }) {
          return <td className="min-w-[8rem] whitespace-normal px-3 py-2 align-top text-slate-600 [overflow-wrap:break-word]">{children}</td>;
        },
        a({ href, children }) {
          const value = href ?? "";
          const looksLikeFile = /^(?:[a-z]:\\|\/|\.\/|~\/).+\.[\w]+$/i.test(value);
          return (
            <button
              type="button"
              className="font-medium text-blue-600 underline decoration-blue-300 underline-offset-4 transition hover:text-blue-700"
              onClick={() => {
                if (looksLikeFile) props.onFileClick?.(value);
                else if (value) window.open(value, "_blank", "noopener,noreferrer");
              }}
            >
              {children}
            </button>
          );
        },
        img({ src, alt }) {
          return <img src={src ?? ""} alt={alt ?? ""} className="my-3 max-h-72 rounded-2xl border border-slate-200 object-contain shadow-sm" loading="lazy" />;
        },
      }}
    >
      {props.content}
    </ReactMarkdown>
  );
});

function splitIntoBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split("\n");
  let current = "";
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      if (!inCode && current.trim()) {
        blocks.push({ content: current.trim(), code: false });
        current = "";
      }
      current += current ? `\n${line}` : line;
      if (inCode) {
        blocks.push({ content: current, code: true });
        current = "";
      }
      inCode = !inCode;
      continue;
    }
    if (!inCode && line === "") {
      if (current.trim()) {
        blocks.push({ content: current.trim(), code: false });
        current = "";
      }
      continue;
    }
    current += current ? `\n${line}` : line;
  }
  if (current) blocks.push({ content: inCode ? current : current.trim(), code: inCode });
  return blocks.length ? blocks : [{ content: "", code: false }];
}

function hashBlock(input: string) {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

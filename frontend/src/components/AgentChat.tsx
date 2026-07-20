import { useCallback, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { api, streamAgent, type AgentEvent } from "../lib/api";
import { useAppStore } from "../stores/appStore";

type ChatMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_events: { name: string; arguments?: Record<string, unknown>; result?: unknown; status: "calling" | "done" | "error" }[];
      recommendation?: string;
      audit_hash?: string;
    };

// Tailwind-styled overrides for react-markdown so the streamed markdown
// blends with the dark theme. Restricted to the elements gpt-oss:120b
// actually emits (headings, lists, tables via remark-gfm, code, links) —
// rehype-sanitize strips anything else, so raw HTML from the model can't
// escape into the DOM.
const AGENT_MD_COMPONENTS = {
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props} className="mb-2 last:mb-0" />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong {...props} className="font-semibold text-[color:var(--color-signature)]" />
  ),
  em: (props: React.HTMLAttributes<HTMLElement>) => (
    <em {...props} className="italic text-[color:var(--color-subtle)]" />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul {...props} className="mb-2 ml-4 list-disc space-y-0.5" />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol {...props} className="mb-2 ml-4 list-decimal space-y-0.5" />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => <li {...props} className="leading-[1.5]" />,
  code: (props: React.HTMLAttributes<HTMLElement>) => (
    <code
      {...props}
      className="sgw-mono rounded bg-[color:var(--color-panel-3)] px-1 py-[1px] text-[11.5px] text-[color:var(--color-primary-ink)]"
    />
  ),
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} className="text-[color:var(--color-primary-ink)] underline" target="_blank" rel="noreferrer" />
  ),
  table: (props: React.HTMLAttributes<HTMLTableElement>) => (
    <table {...props} className="my-2 w-full border-collapse text-[11.5px]" />
  ),
  th: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th {...props} className="border-b border-[color:var(--color-border-3)] px-2 py-1 text-left font-semibold" />
  ),
  td: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td {...props} className="border-b border-[color:var(--color-border-3)] px-2 py-1" />
  ),
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 {...props} className="mb-1 mt-2 text-[14px] font-bold" />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props} className="mb-1 mt-2 text-[13px] font-bold" />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 {...props} className="mb-1 mt-2 text-[12.5px] font-semibold" />
  ),
} as const;

const CANNED_QUESTIONS = [
  "Why is this asset flagged? Cite the top three factors.",
  "What's downstream if this asset fails?",
  "How does the risk model work? Explain in plain English.",
  "What NWS alerts are active right now?",
] as const;

export function AgentChat({ assetId }: Readonly<{ assetId: string | null }>) {
  const persona = useAppStore((s) => s.personaInfo());
  const llmLabel = useAppStore((s) => s.llm?.label ?? "loading…");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const submit = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      setBusy(true);
      const userMsg: ChatMessage = { role: "user", content: text };
      const assistantIdx = messages.length + 1;
      setMessages((m) => [
        ...m,
        userMsg,
        { role: "assistant", content: "", tool_events: [] },
      ]);
      setInput("");

      const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));

      try {
        await streamAgent(
          { messages: history, asset_id: assetId ?? undefined },
          (e: AgentEvent) => {
            setMessages((prev) => {
              const idx = assistantIdx < prev.length ? assistantIdx : prev.length - 1;
              const orig = prev[idx];
              if (orig.role !== "assistant") return prev;
              // Fresh object refs so React re-renders reliably as tokens/tools stream in.
              const next = [...prev];
              const msg: ChatMessage & { role: "assistant" } = {
                ...orig,
                tool_events: [...orig.tool_events],
              };
              next[idx] = msg;
              if (e.type === "token") {
                msg.content += e.data;
              } else if (e.type === "tool_call") {
                msg.tool_events.push({ name: e.data.name, arguments: e.data.arguments, status: "calling" });
              } else if (e.type === "tool_result") {
                const last = [...msg.tool_events].reverse().find((t) => t.name === e.data.name && t.status === "calling");
                if (last) {
                  last.status = "done";
                  last.result = e.data.result;
                }
              } else if (e.type === "final") {
                msg.content = e.data.content || msg.content;
                // Strip markdown + tolerate multi-line RECOMMENDATION
                const cleaned = msg.content.replace(/\*\*/g, "");
                const rec = cleaned.match(/RECOMMENDATION:\s*([^]+?)(?:\.\s|\n|$)/i);
                if (rec) msg.recommendation = rec[1].trim().slice(0, 200);
              } else if (e.type === "error") {
                msg.content = `Error: ${e.data.message}`;
              }
              return next;
            });
            requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
          },
        );
      } finally {
        setBusy(false);
      }
    },
    [assetId, busy, messages],
  );

  const executeRecommendation = async (rec: string, msgIdx: number) => {
    if (!assetId) return;
    const isOverride = /override/i.test(rec);
    const action = isOverride ? "override" : "accept";
    try {
      const r = await api.decide({ asset_id: assetId, action, reason: rec, user: persona.user });
      setMessages((prev) => {
        const next = [...prev];
        const msg = next[msgIdx];
        if (msg.role === "assistant") msg.audit_hash = r.audit_hash;
        return next;
      });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-end">
        <span
          className="text-[10px] text-[color:var(--color-faint)]"
          title={`Copilot model: ${llmLabel} · asset-scoped memory · tool access to model + cascade + alerts`}
        >
          {llmLabel} · tool-calling
        </span>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded border border-[color:var(--color-border-3)] bg-[color:var(--color-panel-3)] p-3"
      >
        {messages.length === 0 && (
          <div className="space-y-2">
            <div className="text-[11.5px] text-[color:var(--color-muted-foreground)]">
              Ask about this asset. The agent has tools to look up assets, trace cascades, fetch live NWS alerts, and explain the model.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CANNED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  disabled={busy}
                  onClick={() => submit(q)}
                  className="cursor-pointer rounded-full border border-[color:var(--color-border)] px-2.5 py-1 text-[10.5px] text-[color:var(--color-muted-foreground)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)] disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="text-right">
              <div className="inline-block max-w-[85%] rounded bg-[color:var(--color-primary-soft)] px-2.5 py-1.5 text-left text-[12.5px] text-[color:var(--color-primary-ink)]">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-1.5">
              {m.tool_events.map((t, j) => (
                <ToolEventBadge key={j} name={t.name} args={t.arguments} status={t.status} />
              ))}
              {m.content && (
                <div className="agent-md rounded bg-[color:var(--color-panel)] px-2.5 py-2 text-[12.5px] leading-[1.55] text-[color:var(--color-foreground)]">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeSanitize]}
                    components={AGENT_MD_COMPONENTS}
                  >
                    {m.content}
                  </ReactMarkdown>
                  {busy && i === messages.length - 1 && <span className="ml-1 inline-block h-3 w-2 animate-pulse bg-[color:var(--color-primary-ink)]" />}
                </div>
              )}
              {m.recommendation && !m.audit_hash && assetId && (
                <button
                  onClick={() => executeRecommendation(m.recommendation!, i)}
                  className="rounded bg-[color:var(--color-success)]/25 px-3 py-1 text-[11.5px] font-medium text-[color:var(--color-success)] hover:bg-[color:var(--color-success)]/40"
                >
                  Execute → {m.recommendation.slice(0, 60)}{m.recommendation.length > 60 ? "…" : ""}
                </button>
              )}
              {m.audit_hash && (
                <div className="text-[10px] text-[color:var(--color-success)]">
                  ✓ Executed · audit hash {m.audit_hash.slice(0, 12)}…
                </div>
              )}
            </div>
          ),
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="mt-2 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder="Ask the copilot…"
          className="flex-1 rounded border border-[color:var(--color-border)] bg-[color:var(--color-panel-3)] px-2.5 py-1.5 text-[12.5px] text-[color:var(--color-foreground)] outline-none focus:ring-1 focus:ring-[color:var(--color-primary)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded bg-[color:var(--color-primary)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--color-primary-foreground)] disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function ToolEventBadge({
  name,
  args,
  status,
}: Readonly<{ name: string; args?: Record<string, unknown>; status: "calling" | "done" | "error" }>) {
  const argStr = args && Object.keys(args).length > 0 ? Object.values(args).join(", ") : "";
  const color =
    status === "calling"
      ? "text-[color:var(--color-primary-ink)]"
      : status === "done"
        ? "text-[color:var(--color-muted-foreground)]"
        : "text-[color:var(--color-critical)]";
  return (
    <div className={`text-[10.5px] ${color}`}>
      <span className="sgw-mono">
        {status === "calling" ? "→" : status === "done" ? "✓" : "✗"} {name}({argStr})
      </span>
    </div>
  );
}

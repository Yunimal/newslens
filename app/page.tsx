"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AskRequest, ChatTurn, Cluster } from "@/types/schema";
import { useArticles } from "./lib/useArticles";
import { AssistantMessage } from "./components/AssistantMessage";

// 백엔드 MAX_HISTORY_TURNS(config.ts)와 동일. 서버가 어차피 뒤에서부터 캡하지만,
// 불필요한 페이로드를 줄이려 클라이언트에서도 최근 N턴만 보낸다.
const HISTORY_TURNS = 3;

// 예시 질문을 clusters[].label 에서 동적 생성 (빈 상태 / no_result 안내에서 재사용).
function exampleQuestions(clusters: Cluster[]): string[] {
  return clusters.slice(0, 3).map((c) => `${c.label} 관련 최근 뉴스를 정리해줘`);
}

type UiMessage = {
  role: "user" | "assistant";
  content: string;
  sourceIds?: string[];
  noResult?: boolean;
  error?: string;
  streaming?: boolean;
  askedQuestion?: string; // 이 답변을 유발한 질문 (오류 시 [다시 시도]용)
};

export default function Home() {
  const { byId, clusters } = useArticles();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 마지막(스트리밍 중인 어시스턴트) 메시지를 갱신.
  function patchLast(patch: Partial<UiMessage>) {
    setMessages((m) => m.map((msg, i) => (i === m.length - 1 ? { ...msg, ...patch } : msg)));
  }
  // 토큰 델타 누적 (타이핑 효과).
  function appendToken(text: string) {
    setMessages((m) =>
      m.map((msg, i) => (i === m.length - 1 ? { ...msg, content: msg.content + text } : msg)),
    );
  }

  // 완료된(오류 아님 · 내용 있음) 이전 발화만 맥락으로. 최근 HISTORY_TURNS턴.
  function buildHistory(msgs: UiMessage[]): ChatTurn[] {
    const turns: ChatTurn[] = [];
    for (const msg of msgs) {
      if (msg.error) continue;
      const content = msg.content.trim();
      if (!content) continue;
      turns.push({ role: msg.role, content });
    }
    return turns.slice(-HISTORY_TURNS);
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;

    const history = buildHistory(messages);

    // 오류 시: 오류 UI 표시 + 입력창에 질문 복원(사용자가 수정/재전송 가능).
    const fail = (error: string) => {
      patchLast({ error, streaming: false });
      setQuestion(q);
    };

    setBusy(true);
    setQuestion("");
    setMessages((m) => [
      ...m,
      { role: "user", content: q },
      { role: "assistant", content: "", streaming: true, sourceIds: [], askedQuestion: q },
    ]);

    try {
      const payload: AskRequest = { question: q, ...(history.length ? { history } : {}) };
      const res = await fetch("/api/ask?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // 스트리밍 시작 전 오류(400/429/500)는 JSON { error } 로 온다.
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        fail(data.error ?? `요청 실패: HTTP ${res.status}`);
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      // SSE 프레임 파싱: 각 이벤트는 `data: <json>\n\n`. 청크 경계를 넘어 안전하게 누적 파싱.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (!raw.startsWith("data:")) continue;
          let ev: {
            type?: string;
            text?: string;
            no_result?: boolean;
            source_ids?: string[];
            error?: string;
          };
          try {
            ev = JSON.parse(raw.slice(raw.indexOf(":") + 1).trim());
          } catch {
            continue; // 부분 프레임/비정상 라인은 무시
          }

          if (ev.type === "meta") {
            patchLast({ noResult: Boolean(ev.no_result) });
          } else if (ev.type === "token") {
            appendToken(ev.text ?? "");
          } else if (ev.type === "sources") {
            patchLast({ sourceIds: ev.source_ids ?? [] });
          } else if (ev.type === "error") {
            fail(ev.error ?? "일시적인 오류가 발생했습니다. 다시 시도해 주세요.");
          }
          // "done": 스트림 종료 마커 — 루프 종료로 처리
        }
      }

      patchLast({ streaming: false });
    } catch (err) {
      fail(err instanceof Error ? err.message : "네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const examples = exampleQuestions(clusters);
  function renderExamples() {
    if (examples.length === 0) return null;
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {examples.map((q) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => void ask(q)}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>
    );
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void ask(question);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void ask(question);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-slate-950 px-4 text-slate-100">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-slate-950/80 py-4 backdrop-blur">
        <span className="inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-sm font-medium text-cyan-200">
          NewsLens
        </span>
        <p className="text-sm text-slate-400">뉴스 근거를 붙여 답하는 리서처</p>
        <Link
          href="/dashboard"
          className="ml-auto rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/10"
        >
          📊 대시보드
        </Link>
      </header>

      <div className="flex-1 space-y-6 py-6">
        {messages.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm leading-7 text-slate-300">
            수집된 뉴스에 대해 물어보세요. 답변에는 근거 기사의 인용(<code className="rounded bg-white/10 px-1">[a0001]</code>)이
            붙고, 아래에 해당 기사 카드가 함께 표시됩니다.
            {renderExamples()}
          </div>
        )}

        {messages.map((msg, i) =>
          msg.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-cyan-300/15 px-4 py-2.5 text-sm leading-6 text-cyan-50">
                {msg.content}
              </p>
            </div>
          ) : (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              {msg.error ? (
                <div className="space-y-3">
                  <p className="text-sm leading-6 text-rose-300">{msg.error}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void ask(msg.askedQuestion ?? "")}
                    className="rounded-lg border border-rose-300/40 bg-rose-300/10 px-3 py-1.5 text-sm font-medium text-rose-100 transition hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    다시 시도
                  </button>
                </div>
              ) : msg.noResult && !msg.streaming ? (
                <div>
                  <p className="text-sm leading-7 text-slate-200">
                    수집된 기사 범위에서 관련 내용을 찾지 못했어요. 아래 예시로 다시 물어보세요.
                  </p>
                  {renderExamples()}
                </div>
              ) : msg.streaming && !msg.content ? (
                <p className="animate-pulse text-sm text-cyan-200">브리핑 작성 중...</p>
              ) : (
                <AssistantMessage
                  content={msg.content}
                  sourceIds={msg.sourceIds ?? []}
                  byId={byId}
                  domPrefix={`msg-${i}`}
                  streaming={msg.streaming}
                />
              )}
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={onSubmit}
        className="sticky bottom-0 border-t border-white/10 bg-slate-950/80 py-4 backdrop-blur"
      >
        {busy && (
          <p className="mb-2 flex items-center gap-2 text-xs text-cyan-200">
            <span className="size-1.5 animate-pulse rounded-full bg-cyan-300" />
            브리핑 작성 중...
          </p>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-slate-900/70 p-2 focus-within:border-cyan-300/60">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            rows={1}
            placeholder="뉴스에 대해 물어보세요 (Enter 전송 · Shift+Enter 줄바꿈)"
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-slate-500 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || !question.trim()}
            className="shrink-0 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
          >
            보내기
          </button>
        </div>
      </form>
    </main>
  );
}

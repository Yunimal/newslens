"use client";

import { FormEvent, useState } from "react";

type AskResponse = {
  answer?: string;
  source_ids?: string[];
  no_result?: boolean;
  error?: string;
};

const exampleQuestions = [
  "최근 AI 뉴스 핵심만 요약해줘",
  "규제 관련 이슈를 근거 기사와 함께 정리해줘",
  "반도체와 생성형 AI 흐름을 알려줘",
];

export default function Home() {
  const [question, setQuestion] = useState(exampleQuestions[0]);
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    const q = question.trim();
    if (!q || loading) return;

    setLoading(true);
    setResponse(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = (await res.json().catch(() => ({}))) as AskResponse;
      if (!res.ok) {
        setResponse({ error: data.error ?? `요청 실패: HTTP ${res.status}` });
        return;
      }
      setResponse(data);
    } catch (err) {
      setResponse({ error: err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-100 sm:px-8">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-4xl flex-col justify-center">
        <div className="mb-8 inline-flex w-fit items-center rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-sm text-cyan-200">
          NewsLens · RAG briefing demo
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
              뉴스 근거를 붙여 답하는
              <span className="block bg-gradient-to-r from-cyan-300 to-violet-300 bg-clip-text text-transparent">
                NewsLens
              </span>
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-300">
              질문을 입력하면 mock 기사 인덱스에서 관련 근거를 찾고, 현재 데모 모드에서는 LLM 키 없이도 검색된 기사 ID와 안내 답변을 반환합니다.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {exampleQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuestion(q)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/10"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={ask} className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-cyan-950/30 backdrop-blur">
            <label htmlFor="question" className="text-sm font-medium text-slate-200">
              질문
            </label>
            <textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={6}
              className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/70"
              placeholder="뉴스에 대해 물어보세요"
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="mt-4 w-full rounded-2xl bg-cyan-300 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
            >
              {loading ? "분석 중..." : "근거 기반 답변 받기"}
            </button>

            <div className="mt-5 min-h-44 rounded-2xl border border-white/10 bg-slate-950/70 p-4">
              {!response && !loading && (
                <p className="text-sm leading-6 text-slate-400">
                  결과가 여기에 표시됩니다. 브라우저 주소창에서 <code className="rounded bg-white/10 px-1">/api/ask</code>를 직접 여는 대신 이 폼으로 POST 요청을 보내도록 구성했습니다.
                </p>
              )}
              {loading && <p className="text-sm text-cyan-200">관련 근거를 찾는 중입니다...</p>}
              {response?.error && <p className="text-sm leading-6 text-red-300">{response.error}</p>}
              {response?.answer && (
                <div className="space-y-4">
                  <p className="whitespace-pre-wrap text-sm leading-7 text-slate-100">{response.answer}</p>
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">sources</p>
                    <div className="flex flex-wrap gap-2">
                      {(response.source_ids ?? []).map((id) => (
                        <span key={id} className="rounded-full bg-violet-300/15 px-2.5 py-1 text-xs text-violet-100">
                          {id}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

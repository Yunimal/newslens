// 근거 기사 카드. 제목·매체·발행일·3문장 요약·논조 배지·토픽 칩·원문 링크를 렌더링한다.
// domId 로 인라인 인용 클릭 시 스크롤 타깃이 되고, highlighted 로 잠시 강조된다.

import type { Article, Sentiment } from "@/types/schema";

const SENTIMENT: Record<Sentiment, { label: string; className: string }> = {
  pos: { label: "긍정", className: "border-emerald-400/30 bg-emerald-400/15 text-emerald-200" },
  neu: { label: "중립", className: "border-slate-400/30 bg-slate-400/15 text-slate-200" },
  neg: { label: "부정", className: "border-rose-400/30 bg-rose-400/15 text-rose-200" },
};

export function ArticleCard({
  article,
  domId,
  highlighted = false,
}: {
  article: Article;
  domId?: string;
  highlighted?: boolean;
}) {
  const s = SENTIMENT[article.sentiment];

  return (
    <article
      id={domId}
      className={`scroll-mt-6 rounded-2xl border bg-slate-950/60 p-4 transition ${
        highlighted
          ? "border-cyan-300 ring-2 ring-cyan-300/60"
          : "border-white/10 hover:border-white/20"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold leading-6 text-white">{article.title}</h3>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.className}`}
        >
          {s.label}
        </span>
      </div>

      <p className="mt-1 text-xs text-slate-400">
        {article.press} · {article.published_at}
      </p>

      <ul className="mt-3 space-y-1">
        {article.summary3.map((sentence, i) => (
          <li key={i} className="flex gap-2 text-sm leading-6 text-slate-200">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-slate-500" aria-hidden />
            <span>{sentence}</span>
          </li>
        ))}
      </ul>

      {article.topic_tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {article.topic_tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-300"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-cyan-300 transition hover:text-cyan-200"
      >
        원문 보기
        <span aria-hidden>↗</span>
      </a>
    </article>
  );
}

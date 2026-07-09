"use client";

// 어시스턴트 답변 렌더러.
// 1) 답변 텍스트의 [aXXXX] 인용을 파싱해 인라인 링크(버튼)로 변환 → 클릭 시 해당 근거 카드로
//    스크롤 + 하이라이트. 인용 regex 는 백엔드(prompt.ts)와 동일한 /\[(a\d{4,})\]/g.
// 2) source_ids 를 id→Article Map 으로 조회해 답변 아래에 근거 카드 목록으로 렌더링.

import { Fragment, useState, type ReactNode } from "react";
import type { Article } from "@/types/schema";
import { ArticleCard } from "./ArticleCard";

// 백엔드 extractSourceIds 와 동일한 형식: a + 4자리 이상.
const CITE_RE = /\[(a\d{4,})\]/g;

export function AssistantMessage({
  content,
  sourceIds,
  byId,
  domPrefix,
  streaming = false,
}: {
  content: string;
  sourceIds: string[];
  byId: Map<string, Article>;
  /** 카드 DOM id 네임스페이스 (메시지별로 유일해야 인용 스크롤이 정확) */
  domPrefix: string;
  /** 스트리밍 중이면 답변 끝에 타이핑 커서를 표시 */
  streaming?: boolean;
}) {
  const [highlight, setHighlight] = useState<string | null>(null);

  // 실제 카드로 존재하는 근거만 (Map 에 있는 것만) — 누락 id 는 조용히 제외.
  const sources = sourceIds.map((id) => byId.get(id)).filter((a): a is Article => Boolean(a));
  const cardIds = new Set(sources.map((a) => a.id));
  const cardDomId = (id: string) => `${domPrefix}-card-${id}`;

  function scrollToCard(id: string) {
    const el = document.getElementById(cardDomId(id));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(id);
    window.setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1600);
  }

  return (
    <div className="space-y-4">
      <p className="whitespace-pre-wrap text-sm leading-7 text-slate-100">
        {renderWithCitations(content, cardIds, scrollToCard)}
        {streaming && (
          <span className="ml-0.5 inline-block w-1.5 animate-pulse text-cyan-300" aria-hidden>
            ▍
          </span>
        )}
      </p>

      {sources.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">근거 기사</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {sources.map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                domId={cardDomId(article.id)}
                highlighted={highlight === article.id}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 답변 문자열을 텍스트 조각 + 인용 링크 노드 배열로 변환. 카드가 있는 인용만 링크화한다. */
function renderWithCitations(
  text: string,
  cardIds: Set<string>,
  onCite: (id: string) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  CITE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITE_RE.exec(text)) !== null) {
    const id = m[1];
    if (!cardIds.has(id)) continue; // 근거 카드가 없는 인용은 원문 텍스트 그대로 둔다.
    if (m.index > last) nodes.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    nodes.push(
      <button
        key={key++}
        type="button"
        onClick={() => onCite(id)}
        className="mx-0.5 rounded bg-cyan-300/15 px-1 py-0.5 align-baseline text-xs font-medium text-cyan-200 transition hover:bg-cyan-300/25"
        title="근거 기사로 이동"
      >
        [{id}]
      </button>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return nodes;
}

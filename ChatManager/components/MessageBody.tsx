'use client';

type MessageBodyProps = {
  text?: string;
  thinking?: string;
  extras?: string[];
};

function renderMarkdownLike(text: string) {
  if (!text.includes('```')) {
    return text;
  }

  const parts = text.split(/```/);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <pre key={index}>
        <code>{part.replace(/^\w+\n?/, '')}</code>
      </pre>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

export function MessageBody({ text, thinking, extras }: MessageBodyProps) {
  if (!text && (!extras || extras.length === 0)) {
    return <span className="msg-empty">[无可见内容]</span>;
  }

  return (
    <>
      {thinking ? (
        <details className="msg-thinking" open>
          <summary>思考过程</summary>
          <div className="msg-thinking-body">{renderMarkdownLike(thinking)}</div>
        </details>
      ) : null}
      {text ? <div className="msg-main">{renderMarkdownLike(text)}</div> : null}
      {extras?.map((extra, index) => (
        <p key={index} className="msg-extra">
          {extra}
        </p>
      ))}
    </>
  );
}

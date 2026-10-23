import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function MarkdownView({ source }: { source: string }) {
  return (
    <div className="prose-tresor text-sm">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          img: ({ alt }) => <span className="text-muted">[{alt}]</span>,
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}

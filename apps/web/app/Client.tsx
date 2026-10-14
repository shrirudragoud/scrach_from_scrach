'use client';

import dynamic from 'next/dynamic';

// Konva and Monaco need the browser; keep them out of the server bundle entirely.
const IdeDemo = dynamic(() => import('../components/IdeDemo.tsx'), {
  ssr: false,
  loading: () => <p className="loading">Loading the editor…</p>,
});

export default function Client() {
  return <IdeDemo />;
}

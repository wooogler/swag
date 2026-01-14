'use client';

import { useEffect } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

interface SubmissionPreviewProps {
  document: any[];
}

export default function SubmissionPreview({ document }: SubmissionPreviewProps) {
  const editor = useCreateBlockNote({
    initialContent: document.length > 0 ? document : undefined,
  });

  useEffect(() => {
    if (!editor) return;
    const currentDoc = editor.document;
    if (JSON.stringify(currentDoc) === JSON.stringify(document)) return;
    editor.replaceBlocks(editor.document, document);
  }, [editor, document]);

  return <BlockNoteView editor={editor} editable={false} theme="light" />;
}

import { db } from '@/db/db';
import { assignments } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import EditorClient from '@/components/editor/EditorClient';

interface EditorPageProps {
  params: Promise<{ shareToken: string }>;
}

export default async function EditorPage({ params }: EditorPageProps) {
  const { shareToken } = await params;

  // Fetch assignment
  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.shareToken, shareToken),
  });

  if (!assignment) {
    notFound();
  }

  return (
    <EditorClient
      assignmentId={assignment.id}
      assignmentTitle={assignment.title}
      deadline={assignment.deadline}
    />
  );
}

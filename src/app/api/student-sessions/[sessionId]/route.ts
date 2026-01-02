import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db/db';
import { instructors, studentSessions, chatConversations, chatMessages, editorEvents, assignments } from '@/db/schema';
import { eq } from 'drizzle-orm';

async function getInstructor() {
  const cookieStore = await cookies();
  const instructorId = cookieStore.get('instructor_session')?.value;

  if (!instructorId) {
    return null;
  }

  return db.query.instructors.findFirst({
    where: eq(instructors.id, instructorId),
  });
}

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const instructor = await getInstructor();

    if (!instructor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the session and verify it belongs to the instructor
    const session = await db.query.studentSessions.findFirst({
      where: eq(studentSessions.id, sessionId),
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Verify the session's assignment belongs to the instructor
    const assignment = await db.query.assignments.findFirst({
      where: eq(assignments.id, session.assignmentId),
    });

    if (!assignment || assignment.instructorId !== instructor.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    console.log(`🗑️  Deleting student session: ${session.studentName} (${session.studentEmail})`);

    // Get conversations for this session
    const conversations = await db
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(eq(chatConversations.sessionId, sessionId));

    // Delete chat messages for each conversation
    for (const conv of conversations) {
      await db.delete(chatMessages).where(eq(chatMessages.conversationId, conv.id));
    }

    // Delete conversations
    await db.delete(chatConversations).where(eq(chatConversations.sessionId, sessionId));

    // Delete editor events
    await db.delete(editorEvents).where(eq(editorEvents.sessionId, sessionId));

    // Delete student session
    await db.delete(studentSessions).where(eq(studentSessions.id, sessionId));

    console.log(`✅ Student session deleted: ${session.studentName}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete student session:', error);
    return NextResponse.json(
      { error: 'Failed to delete student session' },
      { status: 500 }
    );
  }
}


import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db/db';
import { instructors, authTokens, assignments, studentSessions, chatConversations, chatMessages, editorEvents } from '@/db/schema';
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

export async function DELETE(request: Request) {
  try {
    const instructor = await getInstructor();

    if (!instructor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`🗑️  Deleting instructor account: ${instructor.email}`);

    // Get all assignments for this instructor
    const instructorAssignments = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(eq(assignments.instructorId, instructor.id));

    const assignmentIds = instructorAssignments.map((a) => a.id);

    // Delete all related data for each assignment
    for (const assignmentId of assignmentIds) {
      // Get all student sessions for this assignment
      const sessions = await db
        .select({ id: studentSessions.id })
        .from(studentSessions)
        .where(eq(studentSessions.assignmentId, assignmentId));

      const sessionIds = sessions.map((s) => s.id);

      // Delete in order due to foreign key constraints
      for (const sessionId of sessionIds) {
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
      }

      // Delete student sessions
      await db.delete(studentSessions).where(eq(studentSessions.assignmentId, assignmentId));
    }

    // Delete all assignments
    await db.delete(assignments).where(eq(assignments.instructorId, instructor.id));

    // Delete auth tokens
    await db.delete(authTokens).where(eq(authTokens.email, instructor.email));

    // Delete instructor
    await db.delete(instructors).where(eq(instructors.id, instructor.id));

    console.log(`✅ Instructor account deleted: ${instructor.email}`);

    // Clear session cookie
    const cookieStore = await cookies();
    cookieStore.delete('instructor_session');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete account:', error);
    return NextResponse.json(
      { error: 'Failed to delete account' },
      { status: 500 }
    );
  }
}


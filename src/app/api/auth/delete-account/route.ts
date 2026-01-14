import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db/db';
import { instructors, authTokens, assignments, studentSessions, chatConversations, chatMessages, editorEvents } from '@/db/schema';
import { eq } from 'drizzle-orm';

async function getUser() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('user_session')?.value;

  if (!userId) {
    return null;
  }

  return db.query.instructors.findFirst({
    where: eq(instructors.id, userId),
  });
}

export async function DELETE(request: Request) {
  try {
    const user = await getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role === 'student') {
      console.log(`🗑️  Deleting student account: ${user.email}`);

      const sessions = await db
        .select({ id: studentSessions.id })
        .from(studentSessions)
        .where(eq(studentSessions.userId, user.id));

      const sessionIds = sessions.map((s) => s.id);

      for (const sessionId of sessionIds) {
        const conversations = await db
          .select({ id: chatConversations.id })
          .from(chatConversations)
          .where(eq(chatConversations.sessionId, sessionId));

        for (const conv of conversations) {
          await db.delete(chatMessages).where(eq(chatMessages.conversationId, conv.id));
        }

        await db.delete(chatConversations).where(eq(chatConversations.sessionId, sessionId));
        await db.delete(editorEvents).where(eq(editorEvents.sessionId, sessionId));
      }

      await db.delete(studentSessions).where(eq(studentSessions.userId, user.id));
      await db.delete(authTokens).where(eq(authTokens.email, user.email));
      await db.delete(instructors).where(eq(instructors.id, user.id));

      const cookieStore = await cookies();
      cookieStore.delete('user_session');

      return NextResponse.json({ success: true });
    }

    console.log(`🗑️  Deleting instructor account: ${user.email}`);

    // Get all assignments for this instructor
    const instructorAssignments = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(eq(assignments.instructorId, user.id));

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
    await db.delete(assignments).where(eq(assignments.instructorId, user.id));

    // Delete auth tokens
    await db.delete(authTokens).where(eq(authTokens.email, user.email));

    // Delete user
    await db.delete(instructors).where(eq(instructors.id, user.id));

    console.log(`✅ Instructor account deleted: ${user.email}`);

    // Clear session cookie
    const cookieStore = await cookies();
    cookieStore.delete('user_session');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete account:', error);
    return NextResponse.json(
      { error: 'Failed to delete account' },
      { status: 500 }
    );
  }
}


import { db } from './db';
import { assignments } from './schema';

async function seed() {
  console.log('🌱 Seeding database...');

  // Create test assignment
  await db.insert(assignments).values({
    id: crypto.randomUUID(),
    title: 'Test Assignment - AI Ethics Essay',
    instructions: `Write a 500-word essay on the ethical implications of AI in education.

Consider the following questions:
- How should AI tools be used in academic settings?
- What are the risks of over-reliance on AI?
- How can we maintain academic integrity while embracing technological assistance?

Use the chatbot to help you brainstorm ideas, but make sure your final essay reflects your own critical thinking.`,
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    shareToken: 'test-assignment-123', // Fixed token for testing
    customSystemPrompt: null,
    includeInstructionInPrompt: false,
    instructorId: null,
    createdAt: new Date(),
  });

  console.log('✅ Test assignment created successfully!');
  console.log('📝 Access URL: http://localhost:3000/s/test-assignment-123');
}

// Run seed
seed()
  .then(() => {
    console.log('🎉 Seeding completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  });

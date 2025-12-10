/**
 * Copy/Paste Validator
 *
 * Tracks all chat messages and validates pasted content to determine
 * if it's from the internal chatbot (allowed) or external source (blocked).
 */

export class CopyValidator {
  private chatHistory: Set<string> = new Set();
  private internalCopyBuffer: string | null = null;

  /**
   * Register a chat message from the assistant
   */
  registerChatMessage(content: string) {
    this.chatHistory.add(content.trim());
  }

  /**
   * Mark content as copied from internal source (chatbot)
   */
  markInternalCopy(content: string) {
    this.internalCopyBuffer = content.trim();
  }

  /**
   * Validate pasted content
   * Returns true if internal (allowed), false if external (blocked)
   */
  validatePaste(pastedContent: string): boolean {
    const trimmed = pastedContent.trim();

    // Block very short pastes (likely external snippets)
    if (trimmed.length < 3) {
      return false;
    }

    // 1. Check if it's the recently copied internal content
    if (this.internalCopyBuffer && trimmed === this.internalCopyBuffer) {
      return true;
    }

    // 2. Exact match in chat history
    if (this.chatHistory.has(trimmed)) {
      return true;
    }

    // 3. Check if pasted content is a substring of any chat message
    for (const chatContent of this.chatHistory) {
      if (chatContent.includes(trimmed) && trimmed.length >= 10) {
        return true;
      }
    }

    // 4. Fuzzy matching for slightly modified content
    // Use stricter threshold (95%) and require minimum length
    if (trimmed.length >= 20) {
      for (const chatContent of this.chatHistory) {
        const similarity = this.calculateSimilarity(trimmed, chatContent);
        if (similarity >= 0.95) {
          return true;
        }
      }
    }

    // External paste detected
    return false;
  }

  /**
   * Calculate similarity between two strings using Levenshtein distance
   * Returns value between 0 (completely different) and 1 (identical)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
      return 1.0;
    }

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    // Initialize matrix
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Clear internal copy buffer (call after paste is processed)
   */
  clearCopyBuffer() {
    this.internalCopyBuffer = null;
  }

  /**
   * Get total number of registered chat messages
   */
  getChatHistorySize(): number {
    return this.chatHistory.size;
  }
}

// Global singleton instance for the validator
let globalValidator: CopyValidator | null = null;

export function getGlobalValidator(): CopyValidator {
  if (!globalValidator) {
    globalValidator = new CopyValidator();
  }
  return globalValidator;
}

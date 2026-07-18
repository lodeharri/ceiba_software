/**
 * EmbeddingPort — pure domain interface for text embedding.
 *
 * This port abstracts all embedding operations, regardless of the underlying
 * AI provider. Domain and application layers depend only on this interface;
 * the concrete adapter lives in infrastructure/.
 *
 * Design: design.md §3 R1, Requirement 1 (spec.md).
 */

export interface EmbeddingPort {
  /**
   * Embeds a single text string into a dense vector.
   * @returns A 768-dimensional readonly number array.
   */
  embed(text: string): Promise<readonly number[]>;

  /**
   * Embeds multiple texts in parallel.
   * @returns One 768-dim readonly number array per input string, in the same order.
   */
  embedBatch(texts: string[]): Promise<readonly (readonly number[])[]>;
}

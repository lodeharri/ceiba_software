/**
 * Shared fire-and-forget embedding helper.
 *
 * Used by CreateProductUseCase (Group 8) and UpdateProductUseCase (Group 9).
 * Fail-open: errors are caught and logged as a warning but never thrown.
 *
 * @param product    - the Product aggregate (rehydrated from persisted props)
 * @param embedder   - the EmbeddingPort to compute the vector
 * @param repo       - ProductRepository with updateEmbedding method
 * @param logger     - pino logger for warning on failure
 */
export async function embedInBackground(
  product: { props: { id: string; name: string; description?: string | null; supplier: string } },
  embedder: { embed(text: string): Promise<readonly number[]> },
  repo: { updateEmbedding(id: string, embedding: number[]): Promise<void> },
  logger: { warn(meta: object, msg: string): void },
): Promise<void> {
  const { id, name, description, supplier } = product.props;
  const text = `${name} ${description ?? ''} ${supplier}`.trim();
  try {
    const vector = await embedder.embed(text);
    await repo.updateEmbedding(id, [...vector]);
  } catch (err) {
    logger.warn(
      {
        productId: id,
        provider: 'gemini',
        outcome: 'exhausted',
        reason: err instanceof Error ? err.message : String(err),
      },
      'Embedding computation failed after retries; embedding remains NULL',
    );
  }
}

const MIN_CONTEXT_WINDOW = 1000;

export function readContextWindow(item) {
    const candidates = [
        item?.context_length,
        item?.context_window,
        item?.context_size,
        item?.max_context_length,
        item?.max_model_len,
        item?.max_sequence_length,
        item?.max_input_length,
        item?.max_context_tokens,
        item?.max_input_tokens,
        item?.input_token_limit,
        item?.inputTokenLimit,
        item?.token_limit,
        item?.top_provider?.context_length,
        item?.meta?.context_length,
        item?.meta?.context_window,
        item?.metadata?.context_length,
        item?.metadata?.context_window,
        item?.limits?.context_window,
        item?.limits?.context_length,
        item?.capabilities?.context_length,
        item?.capabilities?.context_window,
    ];

    for (const candidate of candidates) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed) && parsed >= MIN_CONTEXT_WINDOW) {
            return Math.round(parsed);
        }
    }
    return null;
}

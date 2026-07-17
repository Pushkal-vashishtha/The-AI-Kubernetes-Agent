// Minimal OpenRouter client (native fetch, no SDK).
// The API key comes from the environment (provided via InsForge) — never log it.

import config from "../core/config.js";
import logger from "../core/logger.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2_000;
const MAX_TOKENS = 1500;

const RETRYABLE_STATUS = [408, 429, 500, 502, 503, 504];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const truncate = (text, max = 300) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

async function requestOnce({ systemPrompt, userPrompt }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.openRouter.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.openRouter.model,
        temperature: 0,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const body = truncate(await response.text());
      return {
        success: false,
        error: `OpenRouter returned HTTP ${response.status}: ${body}`,
        retryable: RETRYABLE_STATUS.includes(response.status),
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return { success: false, error: "OpenRouter response contained no content", retryable: false };
    }

    return { success: true, content, model: data.model ?? config.openRouter.model, error: null };
  } catch (error) {
    const reason =
      error.name === "AbortError"
        ? `LLM request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        : `LLM request failed: ${error.message}`;
    return { success: false, error: reason, retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call the LLM with retries. Never throws — resolves to:
 *   { success, content, model, error }
 */
export async function chatCompletion(prompts) {
  let result;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    result = await requestOnce(prompts);

    if (result.success) {
      logger.info(`LLM responded (model: ${result.model})`);
      return result;
    }

    if (!result.retryable || attempt === MAX_ATTEMPTS) break;

    logger.warn(`LLM call failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying: ${result.error}`);
    await sleep(RETRY_BASE_DELAY_MS * attempt);
  }

  logger.error(`LLM call failed: ${result.error}`);
  return result;
}

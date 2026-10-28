import { GeminiContent, GeminiPart } from './types';

const SYSTEM_PROMPT = `You are Nexora, an autonomous coding agent running in the browser.
You have tools: write_file, read_file, list_files, delete_file.
Use them to build projects. Do not just describe code, write it.
When you are finished with a task, summarize what you did.`;

export const TOOL_DECLARATIONS = [
  {
    name: 'write_file',
    description: 'Create or overwrite a file.',
    parameters: {
      type: 'OBJECT',
      properties: { path: { type: 'STRING' }, content: { type: 'STRING' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file.',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } }, required: ['path'] },
  },
  {
    name: 'list_files',
    description: 'List all files in the workspace.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'delete_file',
    description: 'Delete a file.',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } }, required: ['path'] },
  },
];

export async function streamGemini(
  history: GeminiContent[],
  onToken: (text: string) => void,
  onThinking: (text: string) => void
): Promise<{ parts: GeminiPart[]; text: string }> {
  const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
  const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.5-flash';

  if (!API_KEY) throw new Error('Missing VITE_GEMINI_API_KEY in .env');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: history,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      generationConfig: { temperature: 0.4, thinkingConfig: { includeThoughts: true } },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API Error: ${response.status} - ${err}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const rawParts: GeminiPart[] = [];
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6);
      if (jsonStr === '[DONE]') continue;

      try {
        const data = JSON.parse(jsonStr);
        const parts = data.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.text !== undefined) {
            if (part.thought) {
              onThinking(part.text);
            } else {
              fullText += part.text;
              onToken(part.text);
            }
          }
          if (part.functionCall) {
            // CRITICAL: Push the raw part (including thoughtSignature)
            rawParts.push(part);
          }
        }
      } catch (e) {
        // ignore JSON parse errors from partial chunks
      }
    }
  }

  return { parts: rawParts, text: fullText };
}

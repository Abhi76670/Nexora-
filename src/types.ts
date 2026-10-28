export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args: any };
  functionResponse?: { name: string; response: any };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
}

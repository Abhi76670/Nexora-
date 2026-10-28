import { useState, useRef, useEffect } from 'react';
import { streamGemini } from './gemini';
import { GeminiContent, ChatMessage, GeminiPart } from './types';
import './index.css';

const K_FS = 'nexora_fs';

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [terminal, setTerminal] = useState<string[]>(['Nexora Agent Ready.']);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load FS on mount
  useEffect(() => {
    const saved = localStorage.getItem(K_FS);
    if (saved) setFiles(JSON.parse(saved));
  }, []);

  const saveFS = (newFs: Record<string, string>) => {
    setFiles(newFs);
    localStorage.setItem(K_FS, JSON.stringify(newFs));
  };

  const logTerminal = (line: string) => setTerminal((prev) => [...prev, line]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  const executeTool = (name: string, args: any) => {
    try {
      switch (name) {
        case 'write_file': {
          if (!args.path || typeof args.content !== 'string') throw new Error('Invalid args');
          const newFs = { ...files, [args.path]: args.content };
          saveFS(newFs);
          logTerminal(`✓ write_file: ${args.path}`);
          return { ok: true, path: args.path };
        }
        case 'read_file': {
          if (!(args.path in files)) throw new Error(`File not found: ${args.path}`);
          logTerminal(`✓ read_file: ${args.path}`);
          return { content: files[args.path] };
        }
        case 'list_files': {
          const list = Object.keys(files);
          logTerminal(`✓ list_files: found ${list.length} files`);
          return { files: list };
        }
        case 'delete_file': {
          const newFs = { ...files };
          delete newFs[args.path];
          saveFS(newFs);
          logTerminal(`✓ delete_file: ${args.path}`);
          return { ok: true };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (e: any) {
      logTerminal(`✗ ${name} error: ${e.message}`);
      return { error: e.message };
    }
  };

  const runAgent = async () => {
    if (!input.trim() || isRunning) return;
    setIsRunning(true);
    const userMsg = input.trim();
    setInput('');

    // UI Messages
    const userMsgId = Date.now().toString();
    const astMsgId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', text: userMsg },
      { id: astMsgId, role: 'assistant', text: '', thinking: '' },
    ]);

    // Gemini History
    let history: GeminiContent[] = [{ role: 'user', parts: [{ text: userMsg }] }];
    const MAX_STEPS = 10;

    for (let step = 0; step < MAX_STEPS; step++) {
      let currentText = '';
      let currentThinking = '';

      try {
        const { parts: rawParts, text } = await streamGemini(
          history,
          (token) => {
            currentText += token;
            setMessages((prev) =>
              prev.map((m) => (m.id === astMsgId ? { ...m, text: currentText } : m))
            );
          },
          (token) => {
            currentThinking += token;
            setMessages((prev) =>
              prev.map((m) => (m.id === astMsgId ? { ...m, thinking: currentThinking } : m))
            );
          }
        );

        // Build the model parts array, preserving the EXACT raw parts (with thoughtSignature)
        const modelParts: GeminiPart[] = [];
        if (text) modelParts.push({ text });
        modelParts.push(...rawParts);

        // Append model turn to history
        history.push({ role: 'model', parts: modelParts });

        // Check for tool calls
        const toolCalls = rawParts.filter((p) => p.functionCall);
        if (toolCalls.length === 0) break; // Done

        // Execute tools and build functionResponse parts
        const toolResponses: GeminiPart[] = [];
        for (const tc of toolCalls) {
          if (!tc.functionCall) continue;
          const { name, args } = tc.functionCall;
          logTerminal(`$ ${name} ${JSON.stringify(args)}`);
          
          const result = executeTool(name, args);
          
          toolResponses.push({
            functionResponse: { name, response: result },
          });
        }

        // Append user turn with tool responses
        history.push({ role: 'user', parts: toolResponses });

      } catch (e: any) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === astMsgId ? { ...m, text: m.text + `\n\n⚠️ Error: ${e.message}` } : m
          )
        );
        logTerminal(`⚠️ Error: ${e.message}`);
        break;
      }
    }
    setIsRunning(false);
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <h2>Files</h2>
        <div className="file-list">
          {Object.keys(files).length === 0 && <p className="empty">No files yet</p>}
          {Object.keys(files).map((f) => (
            <div key={f} className="file-item" onClick={() => alert(files[f])}>
              📄 {f}
            </div>
          ))}
        </div>
      </aside>

      {/* Chat Area */}
      <main className="chat-area">
        <div className="messages">
          {messages.map((m) => (
            <div key={m.id} className={`message ${m.role}`}>
              {m.thinking && (
                <div className="thinking-box">
                  <em>Thinking...</em>
                  <p>{m.thinking}</p>
                </div>
              )}
              {m.text && <p>{m.text}</p>}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        <div className="input-area">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Build a landing page..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                runAgent();
              }
            }}
          />
          <button onClick={runAgent} disabled={isRunning}>
            {isRunning ? 'Running...' : 'Run'}
          </button>
        </div>
      </main>

      {/* Terminal */}
      <aside className="terminal">
        <h2>Terminal</h2>
        <div className="terminal-output">
          {terminal.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </aside>
    </div>
  );
}

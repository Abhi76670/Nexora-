import { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import { streamGemini } from './gemini';
import { GeminiContent, ChatMessage, GeminiPart } from './types';
import './index.css';

const K_FS = 'nexora_fs';
const K_CHAT = 'nexora_chat';
const K_TERM = 'nexora_terminal';

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [terminal, setTerminal] = useState<string[]>(['Nexora Agent Ready.']);
  const [activePreview, setActivePreview] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Load from LocalStorage on mount
  useEffect(() => {
    try {
      const savedFs = localStorage.getItem(K_FS);
      const savedChat = localStorage.getItem(K_CHAT);
      const savedTerm = localStorage.getItem(K_TERM);
      
      if (savedFs) setFiles(JSON.parse(savedFs));
      if (savedChat) setMessages(JSON.parse(savedChat));
      if (savedTerm) setTerminal(JSON.parse(savedTerm));
    } catch (e) {
      console.error("Failed to load from local storage");
    }
  }, []);

  // Save to LocalStorage on changes
  useEffect(() => { localStorage.setItem(K_FS, JSON.stringify(files)); }, [files]);
  useEffect(() => { localStorage.setItem(K_CHAT, JSON.stringify(messages)); }, [messages]);
  useEffect(() => { localStorage.setItem(K_TERM, JSON.stringify(terminal)); }, [terminal]);

  const logTerminal = (line: string) => setTerminal((prev) => [...prev, line]);
  
  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(scrollToBottom, [messages]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminal]);

  // Auto-select index.html for preview
  useEffect(() => {
    if (!activePreview && files['index.html']) setActivePreview('index.html');
    else if (!activePreview) {
      const firstHtml = Object.keys(files).find(f => f.endsWith('.html'));
      if (firstHtml) setActivePreview(firstHtml);
    }
  }, [files, activePreview]);

  const startNewProject = () => {
    if (!confirm('Start a new project? Current files and chat will be deleted.')) return;
    localStorage.removeItem(K_FS);
    localStorage.removeItem(K_CHAT);
    localStorage.removeItem(K_TERM);
    setFiles({});
    setMessages([]);
    setTerminal(['New project started.']);
    setActivePreview('');
  };

  const downloadZip = async () => {
    if (Object.keys(files).length === 0) return alert('No files to download');
    const zip = new JSZip();
    Object.entries(files).forEach(([path, content]) => zip.file(path, content));
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexora-project.zip';
    a.click();
    URL.revokeObjectURL(url);
  };

  const executeTool = (name: string, args: any) => {
    try {
      switch (name) {
        case 'write_file': {
          setFiles(prev => ({ ...prev, [args.path]: args.content }));
          logTerminal(`✓ write_file: ${args.path}`);
          return { ok: true };
        }
        case 'read_file': {
          if (!(args.path in files)) throw new Error(`File not found: ${args.path}`);
          logTerminal(`✓ read_file: ${args.path}`);
          return { content: files[args.path] };
        }
        case 'list_files': {
          logTerminal(`✓ list_files: ${Object.keys(files).length} files`);
          return { files: Object.keys(files) };
        }
        case 'delete_file': {
          const newFs = { ...files };
          delete newFs[args.path];
          setFiles(newFs);
          logTerminal(`✓ delete_file: ${args.path}`);
          return { ok: true };
        }
        default: throw new Error(`Unknown tool: ${name}`);
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

    const userMsgId = Date.now().toString();
    const astMsgId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', text: userMsg },
      { id: astMsgId, role: 'assistant', text: '', thinking: '' },
    ]);

    let history: GeminiContent[] = [{ role: 'user', parts: [{ text: userMsg }] }];
    
    for (let step = 0; step < 10; step++) {
      let currentText = '';
      let currentThinking = '';

      try {
        const { parts: rawParts, text } = await streamGemini(
          history,
          (token) => {
            currentText += token;
            setMessages((prev) => prev.map((m) => (m.id === astMsgId ? { ...m, text: currentText } : m)));
          },
          (token) => {
            currentThinking += token;
            setMessages((prev) => prev.map((m) => (m.id === astMsgId ? { ...m, thinking: currentThinking } : m)));
          }
        );

        const modelParts: GeminiPart[] = [];
        if (text) modelParts.push({ text });
        modelParts.push(...rawParts);
        history.push({ role: 'model', parts: modelParts });

        const toolCalls = rawParts.filter((p) => p.functionCall);
        if (toolCalls.length === 0) break;

        const toolResponses: GeminiPart[] = [];
        for (const tc of toolCalls) {
          if (!tc.functionCall) continue;
          logTerminal(`$ ${tc.functionCall.name} ${JSON.stringify(tc.functionCall.args).slice(0, 40)}...`);
          const result = executeTool(tc.functionCall.name, tc.functionCall.args);
          toolResponses.push({ functionResponse: { name: tc.functionCall.name, response: result } });
        }
        history.push({ role: 'user', parts: toolResponses });

      } catch (e: any) {
        setMessages((prev) => prev.map((m) => (m.id === astMsgId ? { ...m, text: m.text + `\n\n⚠️ ${e.message}` } : m)));
        logTerminal(`⚠️ Error: ${e.message}`);
        break;
      }
    }
    setIsRunning(false);
  };

  return (
    <div className="layout">
      {/* 1. LEFT SIDEBAR */}
      <aside className="sidebar">
        <button className="btn-new" onClick={startNewProject}>+ New Project</button>
        
        <div className="files-section">
          <h3>Files</h3>
          {Object.keys(files).length === 0 && <p className="empty">No files</p>}
          {Object.keys(files).map(f => (
            <div 
              key={f} 
              className={`file-item ${activePreview === f ? 'active' : ''}`} 
              onClick={() => f.endsWith('.html') ? setActivePreview(f) : alert('Preview only for HTML files')}
            >
              📄 {f}
            </div>
          ))}
        </div>

        <button className="btn-download" onClick={downloadZip}>⬇️ Download ZIP</button>
      </aside>

      {/* 2. CENTER: CHAT */}
      <main className="chat">
        <div className="chat-header">
          <h2>Nexora Agent</h2>
        </div>
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="welcome">
              <h3>Ready to build</h3>
              <p>Ask me to create a file, e.g., "Create a dark theme login page in index.html"</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              {m.thinking && (
                <div className="thinking">
                  <strong>Thinking:</strong> {m.thinking}
                </div>
              )}
              {m.text && <div className="text">{m.text}</div>}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        <div className="chat-input">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Nexora..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAgent(); }
            }}
          />
          <button onClick={runAgent} disabled={isRunning}>{isRunning ? '...' : 'Run'}</button>
        </div>
      </main>

      {/* 3. RIGHT: PREVIEW + TERMINAL */}
      <aside className="right-panel">
        {/* Preview */}
        <div className="preview-box">
          <div className="panel-header">
            <h3>Preview</h3>
            {activePreview && <span className="badge">{activePreview}</span>}
          </div>
          <div className="preview-content">
            {activePreview ? (
              <iframe srcDoc={files[activePreview]} sandbox="allow-scripts" title="Preview" />
            ) : (
              <div className="empty-preview">Click on an HTML file to preview</div>
            )}
          </div>
        </div>

        {/* Terminal */}
        <div className="terminal-box">
          <div className="panel-header">
            <h3>View Terminal</h3>
          </div>
          <div className="terminal-content">
            {terminal.map((line, i) => <div key={i}>{line}</div>)}
            <div ref={terminalEndRef} />
          </div>
        </div>
      </aside>
    </div>
  );
}

import { useEffect, useState, useRef } from "react";

import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";

// 這些常數可以放在外面
const HAS_WEBGPU = !!navigator.gpu;
const STICKY_SCROLL_THRESHOLD = 120;
const EXAMPLES = [
  "請問如何申請退貨？",
  "滿多少元可以免運？",
  "你們的客服電話是多少？",
];

function App() {
  // --- 關鍵修正：將 useState 移入 App 函式內部 ---
  const [activeDevice, setActiveDevice] = useState(null); 
  // ------------------------------------------

  const worker = useRef(null);
  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);

  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progressItems, setProgressItems] = useState([]);
  const [isRunning, setIsRunning] = useState(false);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [tps, setTps] = useState(null);
  const [numTokens, setNumTokens] = useState(null);

  function onEnter(message) {
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setTps(null);
    setIsRunning(true);
    setInput("");
  }

  function onInterrupt() {
    worker.current.postMessage({ type: "interrupt" });
  }

  useEffect(() => {
    resizeInput();
  }, [input]);

  function resizeInput() {
    if (!textareaRef.current) return;
    const target = textareaRef.current;
    target.style.height = "auto";
    const newHeight = Math.min(Math.max(target.scrollHeight, 24), 200);
    target.style.height = `${newHeight}px`;
  }

  useEffect(() => {
    if (!worker.current) {
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
      worker.current.postMessage({ type: "check" });
    }

    const onMessageReceived = (e) => {
      switch (e.data.status) {
        case "device_info":
          setActiveDevice(e.data.device);
          break;
        case "loading":
          setStatus("loading");
          setLoadingMessage(e.data.data);
          break;
        case "initiate":
          setProgressItems((prev) => [...prev, e.data]);
          break;
        case "progress":
          setProgressItems((prev) =>
            prev.map((item) => (item.file === e.data.file ? { ...item, ...e.data } : item))
          );
          break;
        case "done":
          setProgressItems((prev) => prev.filter((item) => item.file !== e.data.file));
          break;
        case "ready":
          setStatus("ready");
          break;
        case "start":
          setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
          break;
        case "update":
          const { output, tps, numTokens } = e.data;
          setTps(tps);
          setNumTokens(numTokens);
          setMessages((prev) => {
            const cloned = [...prev];
            const last = cloned.at(-1);
            cloned[cloned.length - 1] = { ...last, content: last.content + output };
            return cloned;
          });
          break;
        case "complete":
          setIsRunning(false);
          break;
        case "error":
          setError(e.data.data);
          break;
        default:
          break;
      }
    };

    worker.current.addEventListener("message", onMessageReceived);
    return () => worker.current.removeEventListener("message", onMessageReceived);
  }, []);

  useEffect(() => {
    if (messages.filter((x) => x.role === "user").length === 0) return;
    if (messages.at(-1).role === "assistant") return;
    setTps(null);
    worker.current.postMessage({ type: "generate", data: messages });
  }, [messages, isRunning]);

  useEffect(() => {
    if (!chatContainerRef.current || !isRunning) return;
    const element = chatContainerRef.current;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < STICKY_SCROLL_THRESHOLD) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, isRunning]);

  return (
    <div className="flex flex-col h-screen mx-auto items justify-end text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900">
      
      {/* 頂部狀態與警告區域 */}
      {status === "ready" && (
        <div className="w-full flex flex-col">
          <div className="flex justify-center items-center py-1.5 gap-2 border-b dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
            <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">目前運算裝置:</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
              activeDevice === "WebGPU" 
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" 
                : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
            }`}>
              {activeDevice || "偵測中..."}
            </span>
          </div>

          {activeDevice === "CPU (WASM)" && (
            <div className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 text-xs text-center py-2.5 font-medium border-b border-yellow-500/20">
              ⚠️ 偵測不到 WebGPU 環境，目前使用 CPU 模式運行，回覆速度將會較慢。
            </div>
          )}
        </div>
      )}

      {/* 初始載入畫面 */}
      {status === null && messages.length === 0 && (
        <div className="h-full overflow-auto flex justify-center items-center flex-col p-4 text-center">
          <img src="logo.png" width="120px" height="auto" className="mb-4" alt="AAA Logo" />
          <h1 className="text-3xl font-bold mb-2">AAA 智能客服</h1>
          <p className="text-gray-500 dark:text-gray-400 max-w-[400px] mb-6">
            歡迎使用 AAA 智慧家居助手。本系統直接在您的瀏覽器中運行，確保您的對話隱私不外洩。
          </p>

          <div className="flex flex-col items-center w-full max-w-[500px]">
            {error && <div className="text-red-500 mb-4 bg-red-50 p-3 rounded-lg text-sm w-full">{error}</div>}
            <button
              className="w-full max-w-[280px] border px-6 py-3 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 transition-all shadow-lg font-medium"
              onClick={() => {
                worker.current.postMessage({ type: "load" });
                setStatus("loading");
              }}
              disabled={status !== null || error !== null}
            >
              {HAS_WEBGPU ? "啟動客服系統 (GPU 加速)" : "啟動客服系統 (CPU 模式)"}
            </button>
            <p className="mt-4 text-[11px] text-gray-400">首次啟動將下載約 2.3GB 的 AI 組件</p>
          </div>
        </div>
      )}

      {/* 下載進度畫面 */}
      {status === "loading" && (
        <div className="w-full max-w-[500px] mx-auto p-6 mt-auto mb-auto">
          <p className="text-center mb-4 font-medium text-blue-600 animate-pulse">{loadingMessage}</p>
          {progressItems.map(({ file, progress, total }, i) => (
            <Progress key={i} text={file} percentage={progress} total={total} />
          ))}
        </div>
      )}

      {/* 聊天對話區塊 */}
      {status === "ready" && (
        <div ref={chatContainerRef} className="overflow-y-auto scrollbar-thin w-full flex flex-col items-center h-full">
          <Chat messages={messages} />
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-2 mt-auto mb-8 text-center">
              <p className="text-sm text-gray-400 mb-2">您可以試著問我：</p>
              <div className="flex flex-wrap justify-center gap-2 px-4">
                {EXAMPLES.map((msg, i) => (
                  <button
                    key={i}
                    className="px-4 py-2 border dark:border-gray-700 rounded-full bg-gray-50 dark:bg-gray-800 text-sm hover:bg-gray-100 transition-colors"
                    onClick={() => onEnter(msg)}
                  >
                    {msg}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          <div className="text-[10px] text-gray-400 mb-2">
            {tps && messages.length > 0 && (
              <span>
                生成速度: {tps.toFixed(2)} tokens/sec
                {!isRunning && (
                  <span className="ml-2 underline cursor-pointer" onClick={() => {
                    worker.current.postMessage({ type: "reset" });
                    setMessages([]);
                  }}>重設對話</span>
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 輸入區塊 */}
      <div className="mt-2 border dark:border-gray-700 dark:bg-gray-800 rounded-2xl w-[600px] max-w-[92%] mx-auto relative mb-4 flex shadow-sm bg-white">
        <textarea
          ref={textareaRef}
          className="w-full px-4 py-4 rounded-2xl bg-transparent border-none outline-none text-gray-800 dark:text-gray-100 placeholder-gray-400 resize-none disabled:cursor-not-allowed"
          placeholder="輸入您的訊息..."
          rows={1}
          value={input}
          disabled={status !== "ready"}
          onKeyDown={(e) => {
            if (input.length > 0 && !isRunning && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onEnter(input);
            }
          }}
          onInput={(e) => setInput(e.target.value)}
        />
        <div className="flex items-end p-2">
          {isRunning ? (
            <button onClick={onInterrupt} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700">
              <StopIcon className="h-5 w-5 text-red-500" />
            </button>
          ) : (
            <button 
              onClick={() => input.length > 0 && onEnter(input)}
              className={`p-2 rounded-lg transition-colors ${input.length > 0 ? "bg-blue-600 text-white" : "text-gray-300"}`}
            >
              <ArrowRightIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
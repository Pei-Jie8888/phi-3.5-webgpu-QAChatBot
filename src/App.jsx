import { useEffect, useState, useRef } from "react";
import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";

// 僅作為 UI 提示參考，不再強制阻擋渲染
const IS_WEBGPU_AVAILABLE = !!navigator.gpu;
const STICKY_SCROLL_THRESHOLD = 120;
const EXAMPLES = [
  "Give me some tips to improve my time management skills.",
  "What is the difference between AI and ML?",
  "Write python code to compute the nth fibonacci number.",
];

function App() {
  // Worker 引用
  const worker = useRef(null);
  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);

  // 狀態管理
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progressItems, setProgressItems] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [device, setDevice] = useState(null); // 新增：儲存目前使用的設備名稱

  // 輸入與對話資料
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [tps, setTps] = useState(null);
  const [numTokens, setNumTokens] = useState(null);

  // 處理訊息發送
  function onEnter(message) {
    if (!message.trim()) return;
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setTps(null);
    setIsRunning(true);
    setInput("");
  }

  // 處理中斷生成
  function onInterrupt() {
    worker.current.postMessage({ type: "interrupt" });
  }

  // 文字框高度自適應
  useEffect(() => {
    if (!textareaRef.current) return;
    const target = textareaRef.current;
    target.style.height = "auto";
    const newHeight = Math.min(Math.max(target.scrollHeight, 24), 200);
    target.style.height = `${newHeight}px`;
  }, [input]);

  // 初始化 Worker 並設置監聽器
  useEffect(() => {
    if (!worker.current) {
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
      worker.current.postMessage({ type: "check" });
    }

    const onMessageReceived = (e) => {
      switch (e.data.status) {
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
          setDevice(e.data.device); // 接收來自 Worker 的設備資訊
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

  // 當訊息更新時觸發生成
  useEffect(() => {
    if (messages.length === 0 || messages.at(-1).role === "assistant") return;
    worker.current.postMessage({ type: "generate", data: messages });
  }, [messages]);

  // 自動捲動聊天內容
  useEffect(() => {
    if (!chatContainerRef.current) return;
    const element = chatContainerRef.current;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < STICKY_SCROLL_THRESHOLD) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, isRunning]);

  return (
    <div className="flex flex-col h-screen mx-auto text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 transition-colors">
      
      {/* 1. 初始畫面 (未載入模型) */}
      {status === null && messages.length === 0 && (
        <div className="h-full flex flex-col justify-center items-center p-4">
          <div className="flex flex-col items-center mb-6 max-w-[400px] text-center">
            <img src="logo.png" width="120" height="auto" className="mb-4" alt="Phi Logo" />
            <h1 className="text-4xl font-bold mb-2">Phi-3.5 WebGPU</h1>
            <p className="font-medium opacity-80">
              私密且強大的本地 AI 客服
              <br />
              直接在您的瀏覽器運行
            </p>
          </div>

          <div className="max-w-[500px] text-center space-y-4 text-sm">
            <p>
              您即將載入約 2.3 GB 的 Phi-3.5 模型。下載後將儲存於瀏覽器快取中。
              <br />
              {!IS_WEBGPU_AVAILABLE && (
                <span className="text-orange-500 block mt-2 font-bold">
                  ⚠️ 偵測到環境不支援 WebGPU，將自動回退至 CPU (WASM) 模式。
                </span>
              )}
            </p>

            {error && (
              <div className="p-3 bg-red-100 text-red-700 rounded-lg">
                載入失敗: {error}
              </div>
            )}

            <button
              className="px-8 py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:bg-gray-400 transition-all shadow-lg"
              onClick={() => {
                worker.current.postMessage({ type: "load" });
                setStatus("loading");
              }}
              disabled={status !== null || error !== null}
            >
              啟動模型
            </button>
          </div>
        </div>
      )}

      {/* 2. 載入狀態 (顯示進度條) */}
      {status === "loading" && (
        <div className="h-full flex flex-col justify-center items-center w-full max-w-[500px] mx-auto px-6">
          <p className="mb-4 text-lg font-medium animate-pulse">{loadingMessage}</p>
          <div className="w-full space-y-2">
            {progressItems.map(({ file, progress, total }, i) => (
              <Progress key={i} text={file} percentage={progress} total={total} />
            ))}
          </div>
        </div>
      )}

      {/* 3. 聊天主畫面 (Ready) */}
      {status === "ready" && (
        <div ref={chatContainerRef} className="flex-1 overflow-y-auto scrollbar-thin flex flex-col items-center pt-4">
          
          {/* 設備資訊顯示標籤 */}
          <div className="sticky top-0 z-10 mb-4 px-4 py-1.5 rounded-full text-[11px] font-bold tracking-widest bg-white/80 dark:bg-gray-900/80 backdrop-blur border dark:border-gray-700 shadow-sm">
            STATUS: <span className={device?.includes("GPU") ? "text-green-500" : "text-orange-500"}>{device}</span>
          </div>

          <Chat messages={messages} />

          {/* 範例問題區塊 */}
          {messages.length === 0 && (
            <div className="flex flex-col gap-2 mt-8 w-full max-w-[600px] px-4">
              <p className="text-center text-gray-400 text-sm mb-2">試試看詢問以下問題：</p>
              {EXAMPLES.map((msg, i) => (
                <button
                  key={i}
                  className="text-left border dark:border-gray-700 rounded-xl p-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                  onClick={() => onEnter(msg)}
                >
                  {msg}
                </button>
              ))}
            </div>
          )}

          {/* 生成效能資訊顯示 */}
          <div className="text-center text-xs text-gray-500 dark:text-gray-400 my-4 h-6">
            {tps && messages.length > 0 && (
              <p>
                {!isRunning && `完成 ${numTokens} 個 Token | `}
                速度：<span className="font-bold text-gray-800 dark:text-gray-100">{tps.toFixed(2)} tokens/sec</span>
                {!isRunning && (
                  <button 
                    className="ml-2 underline hover:text-blue-500" 
                    onClick={() => { worker.current.postMessage({ type: "reset" }); setMessages([]); }}
                  >
                    重置對話
                  </button>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 4. 固定在底部的輸入區域 */}
      <div className="p-4 border-t dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-[800px] mx-auto relative flex items-end gap-2 bg-gray-100 dark:bg-gray-800 p-2 rounded-2xl shadow-inner border dark:border-gray-700">
          <textarea
            ref={textareaRef}
            className="flex-1 bg-transparent px-3 py-2 outline-none text-gray-800 dark:text-gray-200 placeholder-gray-400 resize-none min-h-[44px] max-h-[200px]"
            placeholder={status === "ready" ? "輸入您的問題..." : "模型準備中..."}
            rows={1}
            value={input}
            disabled={status !== "ready"}
            onKeyDown={(e) => {
              if (input.trim() && !isRunning && e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onEnter(input);
              }
            }}
            onChange={(e) => setInput(e.target.value)}
          />
          <div className="pb-1 pr-1">
            {isRunning ? (
              <button onClick={onInterrupt} className="p-2 bg-white dark:bg-gray-700 text-red-500 rounded-xl shadow-sm hover:scale-105 transition">
                <StopIcon className="h-6 w-6" />
              </button>
            ) : (
              <button
                onClick={() => input.trim() && onEnter(input)}
                disabled={!input.trim() || status !== "ready"}
                className={`p-2 rounded-xl shadow-sm transition-all ${
                  input.trim() && status === "ready"
                  ? "bg-blue-600 text-white hover:scale-105"
                  : "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                }`}
              >
                <ArrowRightIcon className="h-6 w-6" />
              </button>
            )}
          </div>
        </div>
        <p className="text-[10px] text-gray-400 text-center mt-3 tracking-wider">
          PHIL-3.5 WEB • LOCAL INFERENCE
        </p>
      </div>
    </div>
  );
}

export default App;
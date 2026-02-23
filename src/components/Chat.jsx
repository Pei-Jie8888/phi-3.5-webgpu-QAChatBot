import { marked } from "marked";
import DOMPurify from "dompurify";

import BotIcon from "./icons/BotIcon";
import UserIcon from "./icons/UserIcon";

import "./Chat.css";
import { useEffect } from "react";

function render(text) {
  return DOMPurify.sanitize(marked.parse(text));
}

export default function Chat({ messages }) {
  const empty = messages.length === 0;

  useEffect(() => {
    if (window.MathJax) {
      window.MathJax.typeset();
    }
  }, [messages]);

  return (
    <div
      className={`flex-1 p-6 max-w-[960px] w-full mx-auto ${
        empty ? "flex flex-col items-center justify-end" : "flex flex-col space-y-8"
      }`}
    >
      {empty ? (
        <div className="text-xl font-medium text-gray-400">準備就緒，請隨時提問。</div>
      ) : (
        messages.map((msg, i) => {
          // 1. 隱藏系統提示詞
          if (msg.role === "system") return null;

          const isAssistant = msg.role === "assistant";

          return (
            /* 外層容器：強制 w-full 並根據角色決定內容靠左 (start) 或靠右 (end) */
            <div
              key={`message-${i}`}
              className={`flex w-full ${isAssistant ? "justify-start" : "justify-end"}`}
            >
              {/* 內層容器：包含圖示與氣泡，用戶模式下使用 flex-row-reverse 反轉順序 */}
              <div
                className={`flex items-start max-w-[85%] ${
                  isAssistant ? "flex-row" : "flex-row-reverse"
                }`}
              >
                {/* 圖示區塊 */}
                <div className={`${isAssistant ? "mr-3" : "ml-3"} flex-shrink-0`}>
                  {isAssistant ? (
                    <BotIcon className="h-6 w-6 my-2 text-gray-500 dark:text-gray-300" />
                  ) : (
                    <UserIcon className="h-6 w-6 my-2 text-blue-500 dark:text-blue-300" />
                  )}
                </div>

                {/* 對話氣泡 */}
                <div
                  className={`rounded-2xl p-4 shadow-sm ${
                    isAssistant
                      ? "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-tl-none"
                      : "bg-blue-500 text-white rounded-tr-none"
                  }`}
                >
                  <div className="min-h-6 overflow-wrap-anywhere">
                    {isAssistant ? (
                      msg.content.length > 0 ? (
                        <span
                          className="markdown"
                          dangerouslySetInnerHTML={{
                            __html: render(msg.content),
                          }}
                        />
                      ) : (
                        /* 等待回覆的動畫 */
                        <span className="h-6 flex items-center gap-1">
                          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                        </span>
                      )
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
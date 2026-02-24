import {
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  InterruptableStoppingCriteria,
  env,
} from "@huggingface/transformers";

// 設定環境：不使用本地模型，並關閉 WASM 的 proxy 以提升相容性
env.allowLocalModels = false;
env.backends.onnx.wasm.proxy = false;

/**
 * 使用 Singleton 模式管理模型載入，並實作 WebGPU -> CPU 回退機制
 */
class TextGenerationPipeline {
  static model_id = "onnx-community/Phi-3.5-mini-instruct-onnx-web";
  static model = null;
  static tokenizer = null;
  static device = null; // 用於記錄最終使用的設備名稱

  static async getInstance(progress_callback = null) {
    // 1. 載入 Tokenizer
    this.tokenizer ??= AutoTokenizer.from_pretrained(this.model_id, {
      progress_callback,
    });

    // 2. 載入 Model (帶有 Fallback 邏輯)
    if (!this.model) {
      try {
        console.log("🚀 嘗試啟動 WebGPU 加速...");
        this.model = await AutoModelForCausalLM.from_pretrained(this.model_id, {
          dtype: "q4f16", // GPU 模式使用 Float16 以獲得最佳效能
          device: "webgpu",
          use_external_data_format: true,
          progress_callback,
        });
        this.device = "WebGPU 🚀";
        console.log("✅ WebGPU 啟動成功！");
      } catch (e) {
        console.warn("⚠️ WebGPU 失敗，正在自動回退到 CPU (WASM) 模式...", e);
        this.model = await AutoModelForCausalLM.from_pretrained(this.model_id, {
          dtype: "q4", // CPU 模式建議使用 Float32 (q4) 以確保相容性與精準度
          device: "wasm",
          use_external_data_format: true,
          progress_callback,
        });
        this.device = "CPU (WASM) 🐌";
        console.log("ℹ️ 已成功切換至 CPU 模式。");
      }
    }

    return Promise.all([this.tokenizer, this.model]);
  }
}

const stopping_criteria = new InterruptableStoppingCriteria();

// --- 公司資訊設定 ---
const SYSTEM_PROMPT = `你現在是 AAA 公司的專業客服機器人。請根據以下公司資訊回答客戶問題。如果問題不在資訊範圍內，請客氣地請客戶撥打客服專線。

【公司資訊】
- 退貨政策：AAA 提供 7 天鑑賞期。商品須保持全新、未拆封且包裝完整即可申請全額退款。若商品有瑕疵，請於收到後 24 小時內聯繫客服。
- 聯繫方式：您可以透過電子郵件 support@aaa.com 或撥打客服專線 02-8765-4321 與我們聯絡。服務時間為週一至週五 09:00 - 18:00。
- 運送資訊：全館滿 1000 元免運。一般訂單在下單後 2 個工作天內出貨，配送時間約 3-5 天。
- 公司簡介：AAA 是一家專注於提供高品質智慧家居解決方案的科技公司，致力於讓科技更有溫度。

請用親切、專業且簡潔的繁體中文回答。`;

let past_key_values_cache = null;

/**
 * 執行文字生成
 */
async function generate(messages) {
  const [tokenizer, model] = await TextGenerationPipeline.getInstance();

  // 注入系統提示詞
  const messagesWithContext = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages
  ];

  const inputs = tokenizer.apply_chat_template(messagesWithContext, {
    add_generation_prompt: true,
    return_dict: true,
  });

  let startTime;
  let numTokens = 0;
  let tps;

  const token_callback_function = () => {
    startTime ??= performance.now();
    if (numTokens++ > 0) {
      tps = (numTokens / (performance.now() - startTime)) * 1000;
    }
  };

  const callback_function = (output) => {
    self.postMessage({
      status: "update",
      output,
      tps,
      numTokens,
    });
  };

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function,
    token_callback_function,
  });

  self.postMessage({ status: "start" });

  const { past_key_values, sequences } = await model.generate({
    ...inputs,
    // past_key_values: past_key_values_cache, // 視模型相容性開啟
    do_sample: true,
    top_k: 3,
    temperature: 0.2,
    max_new_tokens: 1024,
    streamer,
    stopping_criteria,
    return_dict_in_generate: true,
  });

  past_key_values_cache = past_key_values;

  const decoded = tokenizer.batch_decode(sequences, {
    skip_special_tokens: true,
  });

  self.postMessage({
    status: "complete",
    output: decoded,
  });
}

/**
 * 檢查環境是否支援 WebGPU
 */
async function check() {
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("WebGPU is not supported (no adapter found)");
    }
  } catch (e) {
    // 這裡不直接報錯給 UI，讓 load() 階段去處理回退
    console.log("Check: WebGPU not available, will use fallback.");
  }
}

/**
 * 預熱與載入模型
 */
async function load() {
  self.postMessage({
    status: "loading",
    data: "正在初始化模型...",
  });

  const [tokenizer, model] = await TextGenerationPipeline.getInstance((x) => {
    self.postMessage(x); // 轉發下載進度
  });

  self.postMessage({
    status: "loading",
    data: `正在編譯著色器 (${TextGenerationPipeline.device})...`,
  });

  // 預熱模型以加速後續生成
  const inputs = tokenizer("a");
  await model.generate({ ...inputs, max_new_tokens: 1 });

  // 傳送就緒訊號，包含最終使用的設備資訊
  self.postMessage({ 
    status: "ready",
    device: TextGenerationPipeline.device 
  });
}

// 監聽來自 App.jsx 的指令
self.addEventListener("message", async (e) => {
  const { type, data } = e.data;

  switch (type) {
    case "check":
      check();
      break;
    case "load":
      load();
      break;
    case "generate":
      stopping_criteria.reset();
      generate(data);
      break;
    case "interrupt":
      stopping_criteria.interrupt();
      break;
    case "reset":
      past_key_values_cache = null;
      stopping_criteria.reset();
      break;
  }
});
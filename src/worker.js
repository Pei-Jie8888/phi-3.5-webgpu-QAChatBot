import {
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  InterruptableStoppingCriteria,
} from "@huggingface/transformers";

/**
 * This class uses the Singleton pattern to enable lazy-loading of the pipeline
 */
class TextGenerationPipeline {
  static model_id = "onnx-community/Phi-3.5-mini-instruct-onnx-web";

  static async getInstance(progress_callback = null) {
    this.tokenizer ??= AutoTokenizer.from_pretrained(this.model_id, {
      progress_callback,
    });

    this.model ??= AutoModelForCausalLM.from_pretrained(this.model_id, {
      // dtype: "q4",
      dtype: "q4f16",
      device: "webgpu",
      use_external_data_format: true,
      progress_callback,
    });

    return Promise.all([this.tokenizer, this.model]);
  }
}

const stopping_criteria = new InterruptableStoppingCriteria();

// --- 新增：公司資訊設定 ---
const SYSTEM_PROMPT = `你現在是 AAA 公司的專業客服機器人。請根據以下公司資訊回答客戶問題。如果問題不在資訊範圍內，請客氣地請客戶撥打客服專線。

【公司資訊】
- 退貨政策：AAA 提供 7 天鑑賞期。商品須保持全新、未拆封且包裝完整即可申請全額退款。若商品有瑕疵，請於收到後 24 小時內聯繫客服。
- 聯繫方式：您可以透過電子郵件 support@aaa.com 或撥打客服專線 02-8765-4321 與我們聯絡。服務時間為週一至週五 09:00 - 18:00。
- 運送資訊：全館滿 1000 元免運。一般訂單在下單後 2 個工作天內出貨，配送時間約 3-5 天。
- 公司簡介：AAA 是一家專注於提供高品質智慧家居解決方案的科技公司，致力於讓科技更有溫度。

請用親切、專業且簡潔的繁體中文回答。`;
// -----------------------

let past_key_values_cache = null;
async function generate(messages) {
  // Retrieve the text-generation pipeline.
  const [tokenizer, model] = await TextGenerationPipeline.getInstance();

  // --- 修改點：將系統資訊注入對話歷史 ---
  const messagesWithContext = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages
  ];

  const inputs = tokenizer.apply_chat_template(messagesWithContext, {
    add_generation_prompt: true,
    return_dict: true,
  });
  // ------------------------------------

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

  // Tell the main thread we are starting
  self.postMessage({ status: "start" });

  const { past_key_values, sequences } = await model.generate({
    ...inputs,
    // TODO: Enable once model is fixed
    // past_key_values: past_key_values_cache,

    // Sampling
    do_sample: true,
    top_k: 3,
    temperature: 0.2, // 保持較低溫度以確保回答的一致性

    max_new_tokens: 1024,
    streamer,
    stopping_criteria,
    return_dict_in_generate: true,
  });
  past_key_values_cache = past_key_values;

  const decoded = tokenizer.batch_decode(sequences, {
    skip_special_tokens: true,
  });

  // Send the output back to the main thread
  self.postMessage({
    status: "complete",
    output: decoded,
  });
}

async function check() {
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("WebGPU is not supported (no adapter found)");
    }
  } catch (e) {
    self.postMessage({
      status: "error",
      data: e.toString(),
    });
  }
}

async function load() {
  self.postMessage({
    status: "loading",
    data: "Loading model...",
  });

  // Load the pipeline and save it for future use.
  const [tokenizer, model] = await TextGenerationPipeline.getInstance((x) => {
    // We also add a progress callback to the pipeline so that we can
    // track model loading.
    self.postMessage(x);
  });

  self.postMessage({
    status: "loading",
    data: "Compiling shaders and warming up model...",
  });

  // Run model with dummy input to compile shaders
  const inputs = tokenizer("a");
  await model.generate({ ...inputs, max_new_tokens: 1 });
  self.postMessage({ status: "ready" });
}
// Listen for messages from the main thread
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

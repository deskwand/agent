/**
 * 语音输入的 PCM 采集 worklet。
 *
 * 为什么是一个独立文件、而不是内联在主进程代码里的字符串：
 * worklet 加载的是**脚本**，受 CSP 的 `script-src` 管辖。本应用的 script-src 是
 * `'self' 'wasm-unsafe-eval'` —— `blob:` 和 `data:` 都不在白名单里，所以只能用
 * 同源真文件。放 `public/` 是因为 vite 会把它**原样**拷到 dist 根：
 * 走 `?url` 导入的话，小于 4KB 的资产会被内联成 `data:` URL，同样会被 CSP 拒掉。
 *
 * 采集参数：每 100ms 交一片 16kHz 单声道 Float32。按帧（128 采样）交会让 IPC
 * 消息多 12 倍，没必要。
 */
const FRAME_SAMPLES = 1600;

class VoicePcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(FRAME_SAMPLES);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i += 1) {
        this.buffer[this.offset] = channel[i];
        this.offset += 1;
        if (this.offset === this.buffer.length) {
          this.port.postMessage(this.buffer.slice());
          this.offset = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("voice-pcm-capture", VoicePcmCapture);

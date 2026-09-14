import { useCallback, useRef, useState } from "react";

/**
 * 媒体解析/语音转写的返回（文件解析来自 `POST /media/analyze`，录音转写来自
 * `POST /voice/transcribe`，两者在这里共用同一份字段契约）。
 */
export interface MediaAnalysisResponse {
  configured?: boolean;
  transcript?: string;
  warnings?: string[];
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript?: string }>>;
}
interface SpeechRecognitionErrorEventLike {
  error?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function audioExtensionForMime(mimeType: string): "m4a" | "webm" {
  return mimeType.toLowerCase().includes("mp4") ? "m4a" : "webm";
}

export function voiceCaptureErrorMessage(error: unknown): string {
  const name = error instanceof DOMException
    ? error.name
    : typeof error === "object" && error && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "麦克风权限未开启。请在浏览器地址栏或系统设置中允许本页面使用麦克风，然后重试。";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "没有检测到可用麦克风，请连接或启用麦克风后重试。";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "麦克风当前无法使用，可能正被微信、会议软件或其他应用占用。关闭占用后再试。";
  }
  if (name === "OverconstrainedError") {
    return "当前麦克风不支持所需的录音设置，请换一个麦克风后重试。";
  }
  return "无法启动语音输入，请检查麦克风权限和设备状态后重试。";
}

export function nativeSpeechErrorMessage(errorCode?: string): string {
  if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
    return "麦克风权限未开启。请在浏览器地址栏或系统设置中允许本页面使用麦克风，然后重试。";
  }
  if (errorCode === "audio-capture") {
    return "没有检测到可用麦克风，或麦克风正被其他应用占用。";
  }
  if (errorCode === "no-speech") {
    return "没有听到清晰语音，请靠近麦克风后重试。";
  }
  if (errorCode === "network") {
    return "语音识别服务网络连接失败，请检查网络后重试。";
  }
  return "语音识别失败，请检查麦克风权限和网络后重试。";
}

export function voiceTranscriptionFailureMessage(analysis: MediaAnalysisResponse | null): string {
  const warning = analysis?.warnings?.find((item) => /语音|转写|ASR|百炼|请求|服务/i.test(item))
    ?? analysis?.warnings?.[0]
    ?? "";
  if (/返回为空|未识别|没有识别|没有.*内容/.test(warning)) {
    return "没有识别到清晰语音。请靠近麦克风、连续说一句完整的话后重试。";
  }
  if (/未配置|未启用/.test(warning) || analysis?.configured === false) {
    return warning || "语音转写服务尚未启用，请联系管理员配置后重试。";
  }
  return warning || "没有识别到清晰语音，请重试或直接输入文字。";
}

/**
 * 平台通用语音输入：优先「录音 + 平台自己的 ASR」（浏览器原生语音识别在国内不可靠），
 * 不支持录音时回落到浏览器原生语音识别。抽自 ChatComposer，公共平台对话页复用同一套行为与文案。
 */
export function useVoiceInput(params: {
  /** 把录音转成文字；返回空 text 表示本次没拿到文字（此时用 message 提示原因）。 */
  transcribe: (blob: Blob) => Promise<{ text: string; message?: string }>;
  /** 拿到文字后回调（由调用方决定怎么并入输入框）。 */
  onText: (text: string) => void;
}): {
  recording: boolean;
  busy: boolean;
  message: string;
  toggle: () => void;
  clearMessage: () => void;
} {
  const { transcribe, onText } = params;
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const startingRef = useRef(false);
  const stopTimerRef = useRef<number | null>(null);

  const stopRecordedStream = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    setRecording(false);
  }, []);

  const transcribeBlob = useCallback(async (blob: Blob) => {
    setBusy(true);
    setMessage("录音完成，正在转成文字…");
    try {
      const result = await transcribe(blob);
      const text = (result.text ?? "").trim();
      if (text) {
        onText(text);
        setMessage("语音已转成文字，请检查后发送。");
      } else {
        setMessage(result.message || "没有识别到清晰语音，请重试或直接输入文字。");
      }
    } catch (error) {
      const detail = error instanceof Error && error.message ? error.message : "未知错误";
      setMessage(`语音转写失败：${detail}`);
    } finally {
      setBusy(false);
    }
  }, [onText, transcribe]);

  const startNativeSpeechRecognition = useCallback(() => {
    const SpeechRecognitionClass =
      (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      setMessage("当前浏览器不支持语音输入，请改用最新版 Chrome、Edge 或系统浏览器。");
      return;
    }
    const recognition = new SpeechRecognitionClass();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const text = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join("")
        .trim();
      if (text) onText(text);
      setMessage(text ? "语音已转成文字，请检查后发送。" : "");
    };
    recognition.onerror = (event) => {
      setMessage(nativeSpeechErrorMessage(event.error));
      setRecording(false);
    };
    recognition.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    setRecording(true);
    setMessage("正在听你说话，说完会自动填进输入框。");
    try {
      recognition.start();
    } catch (error) {
      recognitionRef.current = null;
      setRecording(false);
      setMessage(voiceCaptureErrorMessage(error));
    }
  }, [onText]);

  const startRecordedVoiceInput = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("当前浏览器不支持语音输入，请先用文字输入。");
      return;
    }
    startingRef.current = true;
    setMessage("正在请求麦克风权限…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      let failed = false;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onerror = () => {
        failed = true;
        setMessage("录音中断了，请确认麦克风没有被其他应用占用后重试。");
        if (recorder.state !== "inactive") recorder.stop();
        stopRecordedStream();
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        stopRecordedStream();
        if (failed) return;
        if (blob.size < 512) {
          setMessage("没有录到有效声音。请靠近麦克风说话，再试一次。");
          return;
        }
        void transcribeBlob(blob);
      };
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setMessage("正在录音，再点一次麦克风结束并转成文字。");
      recorder.start(250);
      stopTimerRef.current = window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 120_000);
    } catch (error) {
      setMessage(voiceCaptureErrorMessage(error));
      stopRecordedStream();
    } finally {
      startingRef.current = false;
    }
  }, [stopRecordedStream, transcribeBlob]);

  const toggle = useCallback(() => {
    const activeRecorder = mediaRecorderRef.current;
    if (activeRecorder && activeRecorder.state !== "inactive") {
      setMessage("录音结束，正在准备转成文字…");
      activeRecorder.stop();
      return;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    if (startingRef.current) return;
    if (typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined") {
      void startRecordedVoiceInput();
      return;
    }
    startNativeSpeechRecognition();
  }, [startNativeSpeechRecognition, startRecordedVoiceInput]);

  return {
    recording,
    busy,
    message,
    toggle,
    clearMessage: () => setMessage("")
  };
}

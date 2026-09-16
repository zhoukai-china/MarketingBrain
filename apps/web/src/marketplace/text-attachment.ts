/**
 * 文本类附件（CSV / TSV / TXT …）的字节解码。
 *
 * 背景（2026-09-16 现场缺陷）：视频号助手、抖音创作者中心「另存为 CSV」以及中文 Windows 下
 * 的记事本导出，实际编码常常是 GBK / GB18030，而 `Blob.text()` 与 `new TextDecoder()` 默认
 * 恒按 UTF-8 解——中文表头会整片变成乱码，后端的视频复盘解析器一个字段都认不出来，
 * 于是老板明明传了数据表，却收到「没有识别到视频记录，本次不消耗积分」。
 *
 * 口径：先严格按 UTF-8 解（fatal，遇到非法字节立刻抛错），解不通再按 GB18030 解
 * （GBK / GB2312 是它的子集，覆盖国内后台导出的全部常见情况）。两者都不成立时退回
 * 宽松 UTF-8，保证任何字节序列都有确定的输出，不把异常抛给用户。
 */
export type AttachmentTextEncoding = "utf-8" | "gb18030";

export interface DecodedAttachmentText {
  text: string;
  encoding: AttachmentTextEncoding;
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

export function decodeAttachmentText(bytes: Uint8Array): DecodedAttachmentText {
  try {
    const strict = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: stripBom(strict), encoding: "utf-8" };
  } catch {
    // 不是合法 UTF-8：按国内后台导出最常见的 GB18030 兜底。
  }
  try {
    return { text: stripBom(new TextDecoder("gb18030").decode(bytes)), encoding: "gb18030" };
  } catch {
    return { text: stripBom(new TextDecoder("utf-8").decode(bytes)), encoding: "utf-8" };
  }
}

/** 读取浏览器 `File` / `Blob` 并解码；`File.text()` 的 GBK 安全替代。 */
export async function readAttachmentText(file: { arrayBuffer(): Promise<ArrayBuffer> }): Promise<DecodedAttachmentText> {
  return decodeAttachmentText(new Uint8Array(await file.arrayBuffer()));
}

/**
 * 服务端 402 响应经 pi-ai 折叠进错误文本（status + JSON body），文本匹配为主路径
 */
export function detectInsufficientCredits(text: string): boolean {
  return text.includes("INSUFFICIENT_CREDITS");
}

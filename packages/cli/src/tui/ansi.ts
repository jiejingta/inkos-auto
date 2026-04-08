/* ── ANSI terminal helpers ── zero dependencies ── */

export const reset = "\x1b[0m";
export const bold = "\x1b[1m";
export const dim = "\x1b[2m";
export const italic = "\x1b[3m";

export const red = "\x1b[31m";
export const green = "\x1b[32m";
export const yellow = "\x1b[33m";
export const blue = "\x1b[34m";
export const magenta = "\x1b[35m";
export const cyan = "\x1b[36m";
export const white = "\x1b[37m";
export const gray = "\x1b[90m";
export const brightCyan = "\x1b[96m";
export const brightWhite = "\x1b[97m";

export const clearScreen = "\x1b[2J\x1b[H";
export const showCursor = "\x1b[?25h";
export const hideCursor = "\x1b[?25l";
export const clearLine = "\x1b[2K\r";

export function c(text: string, ...codes: string[]): string {
  return `${codes.join("")}${text}${reset}`;
}

export function termWidth(): number {
  return process.stdout.columns ?? 80;
}

export function hr(char = "─"): string {
  return char.repeat(Math.min(termWidth(), 60));
}

export function box(lines: string[], width = 56): string {
  const top = `╭${"─".repeat(width - 2)}╮`;
  const bot = `╰${"─".repeat(width - 2)}╯`;
  const rows = lines.map((line) => {
    const visible = stripAnsi(line);
    const pad = Math.max(0, width - 2 - visible.length);
    return `│${line}${" ".repeat(pad)}│`;
  });
  return [top, ...rows, bot].join("\n");
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

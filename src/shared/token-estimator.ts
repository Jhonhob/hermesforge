export function estimateTextTokens(text: string) {
  let ascii = 0;
  let nonAscii = 0;
  for (const char of text || "") {
    if (/\s/.test(char)) continue;
    if (char.charCodeAt(0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4 + nonAscii * 0.9);
}

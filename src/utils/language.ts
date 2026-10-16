export type HintLocale = "ko" | "en";

export function detectHintLocale(text: string): HintLocale {
  const koreanCharacters = (text.match(/[가-힣]/g) ?? []).length;
  const latinCharacters = (text.match(/[A-Za-z]/g) ?? []).length;
  return koreanCharacters >= latinCharacters ? "ko" : "en";
}
